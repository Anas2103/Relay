import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MediaMeta } from "../../shared/types";
import { applySpeaker, devicePrefs, liveChoice, VOICE_RATES } from "../lib/devices";
import { formatDuration } from "../lib/media";
import { useDevicePrefs } from "../lib/useDevices";
import { PauseIcon, PlayIcon, Spinner } from "./ui";

const PLAY_EVENT = "relay:voice-play";
const NEXT_EVENT = "relay:voice-next";

/**
 * Voice message player: waveform, seek, speed, volume. Only one plays at a time,
 * and when one ends the next voice message in the chat starts (Settings → Voice & video).
 */
export function VoicePlayer({ id, src, meta, mine }: { id: string; src: string; meta: MediaMeta | null; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const prefs = useDevicePrefs();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const rate = prefs.voiceRate;

  const bars = meta?.waveform?.length ? meta.waveform : Array.from({ length: 40 }, () => 0.3);
  const knownDuration = meta?.duration ?? 0;

  const totalDuration = () => {
    const d = audioRef.current?.duration;
    // Recordings from Chrome report Infinity until fully loaded; fall back to the measured length.
    return d && Number.isFinite(d) ? d : knownDuration;
  };

  // Pause when another voice message starts.
  useEffect(() => {
    const onOtherPlay = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) audioRef.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOtherPlay);
    const root = rootRef.current;
    const onNext = () => void toggle(true);
    root?.addEventListener(NEXT_EVENT, onNext);
    return () => {
      window.removeEventListener(PLAY_EVENT, onOtherPlay);
      root?.removeEventListener(NEXT_EVENT, onNext);
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Speed and volume follow your settings, even while playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    audio.volume = Math.max(0, Math.min(1, prefs.voiceVolume / 100));
  }, [rate, prefs.voiceVolume]);

  const tick = () => {
    const audio = audioRef.current;
    const total = totalDuration();
    if (audio && total) setProgress(Math.min(1, audio.currentTime / total));
    rafRef.current = requestAnimationFrame(tick);
  };

  async function toggle(auto = false) {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
    const p = devicePrefs.get();
    audio.playbackRate = p.voiceRate;
    audio.volume = Math.max(0, Math.min(1, p.voiceVolume / 100));
    // Don't wait for the speaker switch before play(): Safari only allows sound
    // straight from the tap, and an await in between could make it refuse.
    void applySpeaker(audio, liveChoice("speaker")); // your chosen speaker (Settings → Voice & video)
    setLoading(audio.readyState < 2);
    try {
      await audio.play();
      setFailed(false);
    } catch {
      if (!auto) setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  /** Starts the next voice message below this one (in the chat, in order). */
  function playNext() {
    if (!devicePrefs.get().voiceAutoplay) return;
    const all = [...document.querySelectorAll<HTMLElement>("[data-voice-player]")];
    const i = all.indexOf(rootRef.current!);
    all[i + 1]?.dispatchEvent(new CustomEvent(NEXT_EVENT));
  }

  function seek(e: PointerEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    const total = totalDuration();
    if (!audio || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * total;
    setProgress(fraction);
  }

  function cycleRate() {
    const i = (VOICE_RATES as readonly number[]).indexOf(rate);
    devicePrefs.set({ voiceRate: VOICE_RATES[(i + 1) % VOICE_RATES.length] });
  }

  const shown = playing || progress > 0 ? progress * knownDuration : knownDuration;
  const played = mine ? "bg-current" : "bg-accent";
  const unplayed = mine ? "bg-current/35" : "bg-zinc-300 dark:bg-zinc-600";

  return (
    <div ref={rootRef} data-voice-player={id} className="flex w-60 max-w-full items-center gap-3 py-0.5 sm:w-64">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(tick);
        }}
        onPause={() => {
          setPlaying(false);
          cancelAnimationFrame(rafRef.current);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          cancelAnimationFrame(rafRef.current);
          playNext();
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => setFailed(true)}
      />
      <button
        onClick={() => void toggle()}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
          mine ? "bg-current/20 hover:bg-current/30" : "bg-accent text-accent-ink hover:opacity-90"
        }`}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {loading ? <Spinner className="size-4" /> : playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-8 cursor-pointer touch-none items-center gap-[2px]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e);
          }}
          onPointerMove={(e) => e.buttons && seek(e)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(knownDuration)}
          aria-valuenow={Math.round(progress * knownDuration)}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={`min-w-[2px] flex-1 rounded-full transition-colors ${i / bars.length < progress ? played : unplayed}`}
              style={{ height: `${Math.max(12, v * 100)}%` }}
            />
          ))}
        </div>
        <div className={`mt-0.5 flex items-center justify-between text-[11px] tabular-nums ${mine ? "opacity-80" : "text-zinc-500 dark:text-zinc-400"}`}>
          <span>{failed ? "Couldn't play" : formatDuration(shown)}</span>
          <button
            onClick={cycleRate}
            className={`rounded-full px-1.5 py-px font-semibold ${mine ? "bg-current/20" : "bg-zinc-200 dark:bg-zinc-700"}`}
            aria-label={`Playback speed ${rate}x`}
          >
            {rate}×
          </button>
        </div>
      </div>
    </div>
  );
}
