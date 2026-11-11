import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MediaMeta } from "../../shared/types";
import { formatDuration } from "../lib/media";
import { PauseIcon, PlayIcon, Spinner } from "./ui";

const PLAY_EVENT = "relay:voice-play";
const RATES = [1, 1.5, 2] as const;

/** Voice message player: waveform, seek, speed. Only one plays at a time. */
export function VoicePlayer({ id, src, meta, mine }: { id: string; src: string; meta: MediaMeta | null; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);

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
    return () => {
      window.removeEventListener(PLAY_EVENT, onOtherPlay);
      cancelAnimationFrame(rafRef.current);
    };
  }, [id]);

  const tick = () => {
    const audio = audioRef.current;
    const total = totalDuration();
    if (audio && total) setProgress(Math.min(1, audio.currentTime / total));
    rafRef.current = requestAnimationFrame(tick);
  };

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
    audio.playbackRate = rate;
    setLoading(audio.readyState < 2);
    try {
      await audio.play();
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
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
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const shown = playing || progress > 0 ? progress * knownDuration : knownDuration;
  const played = mine ? "bg-current" : "bg-accent";
  const unplayed = mine ? "bg-current/35" : "bg-zinc-300 dark:bg-zinc-600";

  return (
    <div className="flex w-60 max-w-full items-center gap-3 py-0.5 sm:w-64">
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
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => setFailed(true)}
      />
      <button
        onClick={toggle}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
          mine ? "bg-current/20 hover:bg-current/30" : "bg-accent text-accent-ink hover:opacity-90"
        }`}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {loading ? (
          <Spinner className="size-4" />
        ) : playing ? (
          <PauseIcon className="size-4" />
        ) : (
          <PlayIcon className="size-4 translate-x-px" />
        )}
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
