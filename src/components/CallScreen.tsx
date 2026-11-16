import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { CALL_REACTIONS, type NoiseSuppression, type Settings, type User } from "../../shared/types";
import { avatarUrl } from "../lib/api";
import { calls, canShareScreen, type CallState } from "../lib/calls";
import { voiceIsolationSupported } from "../lib/audio";
import { applySpeaker, devicePrefs, liveChoice, type AiEnginePref, type AudioQuality, type DeviceOption, type VideoQuality } from "../lib/devices";
import { outputMethod } from "../lib/output";
import { OutputPicker } from "./OutputPicker";
import { sendToRoom } from "../lib/sendToRoom";
import { useAudioLevel, useDeviceList, useDevicePrefs, useSpeaking } from "../lib/useDevices";
import { DeviceHelp } from "./DeviceHelp";
import { statusText, useCall, useTimer } from "./CallPill";
import {
  Avatar,
  ChevronDownIcon,
  MaximizeIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  PhoneIcon,
  PhoneOffIcon,
  PipIcon,
  ChatIcon,
  SmileIcon,
  ScreenShareIcon,
  SettingsIcon,
  Spinner,
  SwitchCameraIcon,
  VideoIcon,
  VideoOffIcon,
  VolumeIcon,
  XIcon,
} from "./ui";

type VoiceSettings = Pick<Settings, "noiseSuppression" | "echoCancellation" | "autoGainControl" | "noiseGate" | "cleanIncoming">;

/**
 * Attaches a MediaStream to whichever <video>/<audio> element is rendered
 * (a callback ref re-runs when the element is swapped, e.g. full screen ↔ minimized).
 */
function useStream<T extends HTMLMediaElement>(stream: MediaStream | null, extra?: (el: T) => void) {
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      if (stream) el.play().catch(() => {});
      extra?.(el);
    },
    [stream, extra],
  );
}

const hasVideo = (s: MediaStream | null) => !!s && s.getVideoTracks().some((t) => t.readyState === "live");

/** Keeps the phone screen awake during a call. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/** M = mute, V = camera, hold Space = push-to-talk (when you're not typing). */
function useCallShortcuts(on: boolean, pushToTalk: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!on) return;
    const onUp = (e: KeyboardEvent) => {
      if (pushToTalk && e.code === "Space") calls.setTalking(false);
    };
    // Let go when the window loses focus, so the mic never sticks open.
    const onBlur = () => calls.setTalking(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (pushToTalk && e.code === "Space") {
        e.preventDefault();
        calls.setTalking(true);
        return;
      }
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "m") {
        e.preventDefault();
        calls.toggleMic();
      } else if (key === "v") {
        e.preventDefault();
        void calls.toggleCam();
      } else if (key === "escape") {
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [on, pushToTalk, onEscape]);
}

export function CallScreen({
  peer,
  voice,
  onVoiceChange,
  onOpenChat,
}: {
  peer: User | null;
  voice: VoiceSettings;
  onVoiceChange: (patch: Partial<VoiceSettings>) => void;
  /** Opens the chat with the person you were calling. */
  onOpenChat?: (roomId: string) => void;
}) {
  const call = useCall();
  const prefs = useDevicePrefs();
  const list = useDeviceList();
  const minimized = call.minimized;
  const [panel, setPanel] = useState<null | "devices" | "sound">(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [fit, setFit] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const remoteVideoEl = useRef<HTMLVideoElement | null>(null);
  const elapsed = useTimer(call);
  const live = call.phase !== "idle" && call.phase !== "incoming" && call.phase !== "ended";

  // Your speaker choice and their volume, applied to the one element that plays them.
  const speakerId = outputMethod === "sink" ? liveChoice("speaker") : "";
  void list; // re-render (and re-check the speaker) when devices change
  const audioEl = useRef<HTMLAudioElement | null>(null);
  // Browsers can refuse to start sound without a tap (e.g. a call answered from a notification).
  const [soundBlocked, setSoundBlocked] = useState(false);
  const playbackStream = call.playbackStream ?? call.remoteStream;
  // Remote audio always plays through one hidden <audio> element; every <video> is muted,
  // so switching layouts never doubles or cuts the sound.
  const remoteAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      if (!el) return;
      audioEl.current = el;
      if (el.srcObject !== playbackStream) el.srcObject = playbackStream;
      // Through the Web Audio volume knob the element stays at 100%; otherwise it does the volume itself.
      el.volume = call.outputRelayed ? 1 : Math.max(0, Math.min(1, prefs.outputVolume / 100));
      void applySpeaker(el, speakerId);
      if (playbackStream) {
        el.play().then(
          () => setSoundBlocked(false),
          (err: unknown) => {
            if ((err as { name?: string })?.name === "NotAllowedError") setSoundBlocked(true);
          },
        );
      }
    },
    [playbackStream, call.outputRelayed, prefs.outputVolume, speakerId],
  );
  const unblockSound = () => {
    void calls.resumeAudio();
    void audioEl.current?.play().then(() => setSoundBlocked(false), () => {});
  };
  // Paused audio only matters when what you hear (or send) runs through it.
  const needsTap = soundBlocked || (call.audioPaused && call.phase === "active");
  const keepRemoteEl = useCallback((el: HTMLVideoElement) => (remoteVideoEl.current = el), []);
  const remoteVideo = useStream<HTMLVideoElement>(call.remoteStream, keepRemoteEl);
  const localVideo = useStream<HTMLVideoElement>(call.localStream);

  const peerSpeaking = useSpeaking(call.remoteStream, call.phase === "active" && call.peerMicOn && !minimized);
  const meSpeaking = useSpeaking(call.micMonitor, live && !minimized);

  useWakeLock(live);
  const closePanel = useCallback(() => setPanel(null), []);
  useCallShortcuts(live && !minimized, prefs.pushToTalk, closePanel);

  useEffect(() => {
    if (call.phase === "idle" || call.phase === "incoming") {
      setPanel(null);
      setOutputOpen(false);
    }
    if (call.phase !== "active") setReactOpen(false);
    if (call.phase !== "incoming") setReplyOpen(false);
  }, [call.phase]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // Leave full screen when the call ends or is minimized.
  useEffect(() => {
    if ((!live || minimized) && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [live, minimized]);

  if (call.phase === "idle") return null;

  const name = call.peerName || peer?.displayName || "Unknown";
  const seed = call.peerId ?? "call";
  const status = statusText(call, elapsed);
  const remoteVideoOn = call.phase === "active" && (call.peerCamOn || call.peerScreen) && hasVideo(call.remoteStream);
  const localVideoOn = (call.camOn || call.screenSharing) && hasVideo(call.localStream);
  const mirror = prefs.mirror && call.facing === "user" && !call.screenSharing;
  const canPip = remoteVideoOn && typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  const canFullscreen = typeof document !== "undefined" && !!document.documentElement.requestFullscreen && window.matchMedia("(pointer: fine)").matches;
  const canFlip = call.camOn && !call.screenSharing && (list.cameras.length >= 2 || window.matchMedia("(pointer: coarse)").matches);
  const mutedButTalking = live && !call.micOn && meSpeaking && !prefs.pushToTalk;
  const canRedial = call.phase === "ended" && !call.problem && !!call.roomId && !!call.peerId;

  const audio = <audio ref={remoteAudio} autoPlay playsInline className="hidden" />;

  // ---------- Minimized: the call lives in the chat header (CallPill); keep the sound playing ----------
  if (minimized && call.phase !== "ended") {
    return (
      <>
        {audio}
        {needsTap && <SoundBlocked onTap={unblockSound} floating />}
      </>
    );
  }

  // ---------- Full screen ----------
  const picture = peer ? avatarUrl(peer) : null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen().catch(() => {});
  };
  const openPip = () => {
    const v = remoteVideoEl.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void v.requestPictureInPicture().catch(() => {});
  };

  return (
    <div
      ref={rootRef}
      className="fade-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`${call.video ? "Video" : "Voice"} call with ${name}`}
    >
      {audio}

      {/* Backdrop: their video, my camera preview while ringing, or a soft glow made from their picture */}
      {remoteVideoOn ? (
        <video
          ref={remoteVideo}
          autoPlay
          playsInline
          muted
          onDoubleClick={() => setFit((f) => !f)}
          title={call.peerScreen ? undefined : "Double-click to fit / fill"}
          className={`absolute inset-0 size-full ${call.peerScreen || fit ? "object-contain" : "object-cover"}`}
        />
      ) : call.phase !== "active" && localVideoOn ? (
        <>
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 size-full scale-105 object-cover opacity-50 blur-sm ${mirror ? "-scale-x-105" : ""}`}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/70" />
        </>
      ) : (
        <div className="absolute inset-0 overflow-hidden">
          {picture ? (
            <img src={picture} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-3xl" />
          ) : (
            <div className="call-glow absolute -inset-1/4 bg-[radial-gradient(circle_at_30%_30%,var(--accent),transparent_55%),radial-gradient(circle_at_70%_70%,var(--bubble),transparent_50%)] opacity-50 blur-3xl" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/80" />
        </div>
      )}

      {/* Top bar */}
      <div
        className="relative z-20 flex items-center justify-between gap-3 px-4 pt-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <div className="flex w-28 items-center gap-2">
          {live ? (
            <GlassButton label="Minimize — keep chatting" onClick={() => calls.setMinimized(true)}>
              <ChevronDownIcon className="size-5" />
            </GlassButton>
          ) : (
            <span className="size-11" />
          )}
          {live && (
            <GlassButton
              label="Sound output: speaker, earpiece, headphones"
              onClick={() => {
                setPanel(null);
                setOutputOpen((o) => !o);
              }}
              active={outputOpen}
            >
              <VolumeIcon className="size-5" />
            </GlassButton>
          )}
        </div>
        {remoteVideoOn ? (
          <div className="min-w-0 rounded-2xl bg-black/35 px-4 py-1.5 text-center backdrop-blur-md">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-xs text-white/75 tabular-nums">{status}</p>
          </div>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
            <LockGlyph /> <span className="truncate">End-to-end encrypted</span>
          </span>
        )}
        <div className="flex w-28 items-center justify-end gap-2">
          {call.phase === "active" && call.quality && <SignalBars call={call} />}
          {live && canPip && (
            <GlassButton label="Picture in picture" onClick={openPip}>
              <PipIcon className="size-5" />
            </GlassButton>
          )}
          {live && canFullscreen && (
            <GlassButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
              {fullscreen ? <MinimizeIcon className="size-5" /> : <MaximizeIcon className="size-5" />}
            </GlassButton>
          )}
        </div>
      </div>

      {needsTap && live && <SoundBlocked onTap={unblockSound} />}
      {outputOpen && live && (
        <div
          className="pop-in absolute left-3 z-40 w-[min(20rem,calc(100%-1.5rem))] rounded-3xl bg-zinc-900/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
          style={{ top: "max(4rem, calc(env(safe-area-inset-top) + 3.25rem))" }}
          role="dialog"
          aria-label="Sound output"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Sound output</p>
            <button onClick={() => setOutputOpen(false)} aria-label="Close" className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white">
              <XIcon className="size-4" />
            </button>
          </div>
          <OutputPicker audioEl={audioEl.current} />
          <div className="mt-3">
            <RangeRow label={`${call.peerName || "Their"} volume`} value={prefs.outputVolume} max={200} onChange={(v) => devicePrefs.set({ outputVolume: v })} />
          </div>
        </div>
      )}
      {call.reconnecting && (
        <div className="relative z-20 mx-auto mt-3 flex items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-amber-950">
          <Spinner className="size-3" /> Weak connection — reconnecting…
        </div>
      )}
      {call.notice && live && (
        <div
          key={call.notice.id}
          role="status"
          className="pop-in relative z-30 mx-auto mt-3 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-zinc-900/85 py-1.5 pr-1.5 pl-4 text-sm shadow-xl ring-1 ring-white/15 backdrop-blur-md"
        >
          <span className="min-w-0 truncate">{call.notice.text}</span>
          {call.notice.action && (
            <button
              onClick={() => {
                call.notice?.action?.run();
                calls.dismissNotice();
              }}
              className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-900 hover:bg-white/90"
            >
              {call.notice.action.label}
            </button>
          )}
          <button onClick={() => calls.dismissNotice()} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white">
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      {/* Middle: who you're talking to */}
      {!remoteVideoOn ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="relative">
            {(call.phase === "incoming" || call.phase === "outgoing") && (
              <>
                <span className="call-ring absolute inset-0 rounded-full bg-white/25" />
                <span className="call-ring call-ring-delay absolute inset-0 rounded-full bg-white/25" />
              </>
            )}
            <div
              className={`relative rounded-full p-1.5 transition-all duration-200 ${
                peerSpeaking ? "ring-4 ring-emerald-400/90 shadow-[0_0_40px_rgba(52,211,153,0.45)]" : "ring-1 ring-white/20"
              }`}
            >
              <Avatar name={name} seed={seed} user={peer} size="xl" />
            </div>
          </div>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight">{name}</h2>
          <p className="mt-2 flex items-center gap-2 text-base text-white/75 tabular-nums">
            {call.phase === "connecting" && <Spinner className="size-4" />}
            {status}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {call.phase === "active" && call.video && !call.peerCamOn && !call.peerScreen && (
              <Chip icon={<VideoOffIcon className="size-3.5" />}>Camera off</Chip>
            )}
            {call.phase === "active" && !call.peerMicOn && <Chip icon={<MicOffIcon className="size-3.5" />}>{name} is muted</Chip>}
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-end gap-2 pb-4">
          {call.peerScreen && <Chip icon={<ScreenShareIcon className="size-3.5" />}>{name} is sharing their screen</Chip>}
          {!call.peerMicOn && <Chip icon={<MicOffIcon className="size-3.5" />}>{name} is muted</Chip>}
        </div>
      )}

      {/* Floating emoji reactions */}
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
        {call.reactions.map((r) => (
          <span
            key={r.id}
            role="img"
            className="reaction-float absolute bottom-36 text-5xl drop-shadow-lg sm:text-6xl"
            style={{ left: `${r.x * 100}%` }}
            aria-label={r.mine ? `You sent ${r.emoji}` : `${name} sent ${r.emoji}`}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {reactOpen && call.phase === "active" && (
        <div className="pop-in absolute inset-x-0 bottom-28 z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap justify-center gap-1 rounded-3xl bg-zinc-900/90 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:bottom-32">
          {CALL_REACTIONS.map((e) => (
            <button
              key={e}
              onClick={() => calls.sendReaction(e)}
              aria-label={`Send ${e}`}
              className="flex size-11 items-center justify-center rounded-full text-2xl transition hover:scale-110 hover:bg-white/10 active:scale-95"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Push-to-talk hint */}
      {live && prefs.pushToTalk && !panel && !reactOpen && (
        <div
          className={`absolute inset-x-0 bottom-28 z-20 mx-auto w-fit rounded-full px-3 py-1 text-xs font-medium shadow-lg backdrop-blur-md sm:bottom-32 ${
            call.talking ? "bg-emerald-500 text-white" : "bg-black/40 text-white/80"
          }`}
        >
          {call.talking ? "Talking…" : "Push-to-talk: hold Space or the mic button"}
        </div>
      )}

      {/* "You're muted" — like Zoom/Meet, when you start talking while muted */}
      {mutedButTalking && !panel && (
        <button
          onClick={() => calls.setMicOn(true)}
          className="pop-in absolute inset-x-0 bottom-32 z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-2xl sm:bottom-36"
        >
          <MicOffIcon className="size-4 text-red-600" /> You're muted — tap to unmute
        </button>
      )}

      {/* My camera: picture-in-picture, drag it to any corner */}
      {call.phase === "active" && (localVideoOn || remoteVideoOn) && (
        <DraggablePip speaking={meSpeaking && call.micOn}>
          {localVideoOn ? (
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className={`size-full ${call.screenSharing ? "bg-black object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`}
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1 bg-zinc-800 text-white/60">
              <VideoOffIcon className="size-6" />
              <span className="text-[11px]">Camera off</span>
            </div>
          )}
          {call.screenSharing && (
            <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-center text-[10px] font-medium">
              {call.screenAudio ? "Sharing screen + sound" : "Sharing screen"}
            </span>
          )}
          {!call.micOn && (
            <span className="absolute top-2 left-2 rounded-full bg-black/55 p-1">
              <MicOffIcon className="size-3.5" />
            </span>
          )}
        </DraggablePip>
      )}

      {panel && live && (
        <CallSettingsPanel
          tab={panel}
          onTab={setPanel}
          call={call}
          voice={voice}
          onVoiceChange={onVoiceChange}
          onClose={closePanel}
          audioEl={audioEl.current}
        />
      )}

      {/* Controls */}
      <div
        className="relative z-20 flex justify-center px-3 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {call.phase === "incoming" ? (
          <div className="slide-up flex w-full max-w-sm flex-col items-center gap-5">
            <div className="flex w-full items-start justify-around">
              <BigAction label="Decline" color="bg-red-600 hover:bg-red-500" onClick={() => calls.decline()}>
                <PhoneOffIcon className="size-8" />
              </BigAction>
              <BigAction
                label="Accept"
                color="accept-pulse bg-emerald-600 hover:bg-emerald-500"
                onClick={() => calls.accept(call.video ? { camera: !prefs.joinCameraOff } : {})}
              >
                {call.video && !prefs.joinCameraOff ? <VideoIcon className="size-8" /> : <PhoneIcon className="size-8" />}
              </BigAction>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setReplyOpen((o) => !o)}
                aria-expanded={replyOpen}
                className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition hover:bg-white/20"
              >
                <ChatIcon className="size-4" /> Reply with a message
              </button>
              {call.video && (
                <button
                  onClick={() => calls.accept({ camera: prefs.joinCameraOff })}
                  className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition hover:bg-white/20"
                >
                  {prefs.joinCameraOff ? <VideoIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
                  {prefs.joinCameraOff ? "Answer with video" : "Answer without video"}
                </button>
              )}
            </div>
            {replyOpen && call.roomId && <QuickReplies roomId={call.roomId} />}
          </div>
        ) : call.phase === "ended" ? (
          <div className="slide-up flex flex-wrap items-center justify-center gap-3">
            {canRedial && (
              <button
                onClick={() => {
                  const { roomId, peerId, peerName, video } = call;
                  calls.dismiss();
                  void calls.start(roomId!, { id: peerId!, name: peerName || name }, video);
                }}
                className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold shadow-lg transition hover:bg-emerald-500"
              >
                {call.video ? <VideoIcon className="size-4" /> : <PhoneIcon className="size-4" />} Call again
              </button>
            )}
            {canRedial && onOpenChat && (
              <button
                onClick={() => {
                  const roomId = call.roomId!;
                  calls.dismiss();
                  onOpenChat(roomId);
                }}
                className="flex items-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-semibold backdrop-blur-md transition hover:bg-white/25"
              >
                <ChatIcon className="size-4" /> Message
              </button>
            )}
            <button
              onClick={() => calls.dismiss()}
              className="rounded-full bg-white/15 px-6 py-3 text-sm font-semibold backdrop-blur-md transition hover:bg-white/25"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="slide-up flex max-w-full items-center gap-1.5 rounded-full bg-white/10 p-2 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl sm:gap-3">
            <ControlButton
              label={prefs.pushToTalk ? "Hold to talk (Space)" : call.micOn ? "Mute (M)" : "Unmute (M)"}
              active={!call.micOn}
              onClick={() => !prefs.pushToTalk && calls.toggleMic()}
              onHold={prefs.pushToTalk ? (held) => calls.setTalking(held) : undefined}
              disabled={!call.localStream}
              ring={call.micOn && meSpeaking}
            >
              {call.micOn ? <MicIcon className="size-6" /> : <MicOffIcon className="size-6" />}
            </ControlButton>
            {call.canVideo && (
              <ControlButton
                label={call.camOn ? "Turn camera off (V)" : "Turn camera on (V)"}
                active={!call.camOn}
                onClick={() => void calls.toggleCam()}
                disabled={!call.localStream}
              >
                {call.camOn ? <VideoIcon className="size-6" /> : <VideoOffIcon className="size-6" />}
              </ControlButton>
            )}
            {canFlip && (
              <ControlButton label="Switch camera" onClick={() => void calls.switchCamera()} disabled={!call.localStream}>
                <SwitchCameraIcon className="size-6" />
              </ControlButton>
            )}
            {canShareScreen && call.canVideo && (
              <ControlButton
                label={call.screenSharing ? "Stop sharing your screen" : "Share your screen"}
                active={call.screenSharing}
                onClick={() => void calls.toggleScreenShare()}
                disabled={call.phase !== "active"}
              >
                <ScreenShareIcon className="size-6" />
              </ControlButton>
            )}
            {call.phase === "active" && (
              <ControlButton label="Send a reaction" active={reactOpen} onClick={() => setReactOpen((o) => !o)}>
                <SmileIcon className="size-6" />
              </ControlButton>
            )}
            <ControlButton
              label="Call settings: devices, volume, noise suppression"
              active={!!panel}
              onClick={() => {
                setOutputOpen(false);
                setPanel((p) => (p ? null : "devices"));
              }}
              badge={modeBadge(call.voiceMode ?? voice.noiseSuppression)}
            >
              <SettingsIcon className="size-6" />
            </ControlButton>
            <button
              onClick={() => calls.hangUp()}
              aria-label="End call"
              title="End call"
              className="ml-1 flex h-14 w-16 shrink-0 items-center justify-center rounded-full bg-red-600 shadow-lg transition hover:bg-red-500 active:scale-95 sm:w-20"
            >
              <PhoneOffIcon className="size-7" />
            </button>
          </div>
        )}
      </div>

      {call.problem && call.phase === "ended" && (
        <DeviceHelp problem={call.problem} device={call.video ? "camera" : "microphone"} onClose={() => calls.dismiss()} />
      )}
    </div>
  );
}

function modeBadge(mode: NoiseSuppression) {
  return mode === "ai" ? "AI" : mode === "standard" ? "STD" : "OFF";
}

/** Signal bars from the live connection stats; tap for the numbers. */
function SignalBars({ call }: { call: CallState }) {
  const [open, setOpen] = useState(false);
  const bars = call.quality === "good" ? 3 : call.quality === "fair" ? 2 : 1;
  const color = call.quality === "good" ? "bg-emerald-400" : call.quality === "fair" ? "bg-amber-400" : "bg-red-500";
  const label = call.quality === "good" ? "Good connection" : call.quality === "fair" ? "Okay connection" : "Poor connection";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        className="flex size-11 items-end justify-center gap-[3px] rounded-full bg-white/10 pb-3.5 backdrop-blur-md transition hover:bg-white/20"
      >
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-1 rounded-full ${i < bars ? color : "bg-white/25"}`} style={{ height: 6 + i * 4 }} />
        ))}
      </button>
      {open && call.stats && (
        <div className="pop-in absolute top-12 right-0 z-40 w-52 rounded-2xl bg-zinc-900/95 p-3 text-xs shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
          <p className="mb-1.5 text-sm font-semibold">{label}</p>
          <p className="flex justify-between text-white/70">
            Delay <span className="text-white tabular-nums">{call.stats.rtt === null ? "—" : `${call.stats.rtt} ms`}</span>
          </p>
          <p className="flex justify-between text-white/70">
            Packet loss <span className="text-white tabular-nums">{(call.stats.loss * 100).toFixed(1)}%</span>
          </p>
          <p className="flex justify-between text-white/70">
            Route <span className="text-white">{call.stats.relayed ? "Via relay" : "Direct"}</span>
          </p>
          {call.quality !== "good" && <p className="mt-2 text-white/55">Tip: move closer to Wi-Fi, or turn your camera off to save bandwidth.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- In-call settings: devices, volume and noise suppression ----------

const MODES: [NoiseSuppression, string, string][] = [
  ["ai", "AI noise suppression", "Removes fans, keyboards and background voices"],
  ["standard", "Standard", "Your browser's built-in filter"],
  ["off", "Off", "Raw microphone"],
];

function CallSettingsPanel({
  tab,
  onTab,
  call,
  voice,
  onVoiceChange,
  onClose,
  audioEl,
}: {
  audioEl: HTMLMediaElement | null;
  tab: "devices" | "sound";
  onTab: (t: "devices" | "sound") => void;
  call: CallState;
  voice: VoiceSettings;
  onVoiceChange: (patch: Partial<VoiceSettings>) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="slide-up absolute inset-x-3 bottom-28 z-30 mx-auto flex max-h-[calc(100dvh-12rem)] max-w-md flex-col rounded-3xl bg-zinc-900/92 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:bottom-32"
      role="dialog"
      aria-label="Call settings"
    >
      <div className="flex items-center justify-between gap-2 p-3 pb-2">
        <div className="flex rounded-full bg-white/10 p-1" role="tablist">
          {(
            [
              ["devices", "Devices"],
              ["sound", "Noise & voice"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${tab === id ? "bg-white text-zinc-900" : "text-white/75 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="overflow-y-auto px-4 pb-4">
        {tab === "devices" ? <DevicesTab call={call} audioEl={audioEl} /> : <SoundTab call={call} voice={voice} onChange={onVoiceChange} />}
      </div>
    </div>
  );
}

function DevicesTab({ call, audioEl }: { call: CallState; audioEl: HTMLMediaElement | null }) {
  const prefs = useDevicePrefs();
  const list = useDeviceList();
  const level = useAudioLevel(call.micMonitor);
  const shownLevel = Math.min(1, level * (prefs.micVolume / 100));
  return (
    <div className="space-y-4 pt-1">
      <DeviceSelect
        label="Microphone"
        icon={<MicIcon className="size-4" />}
        value={call.micId}
        options={list.mics}
        onPick={(id) => devicePrefs.set({ mic: id })}
      />
      <div className="flex h-1.5 gap-[2px]" role="meter" aria-label="Your microphone level" aria-valuenow={Math.round(shownLevel * 100)} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={`flex-1 rounded-full ${i / 24 < shownLevel ? (i > 20 ? "bg-red-500" : "bg-emerald-400") : "bg-white/15"}`} />
        ))}
      </div>
      <RangeRow label="Mic volume" value={prefs.micVolume} max={200} onChange={(v) => devicePrefs.set({ micVolume: v })} />

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
          <VolumeIcon className="size-4" />
          Sound output
        </span>
        <OutputPicker audioEl={audioEl} />
      </div>
      <RangeRow label={`${call.peerName || "Their"} volume`} value={prefs.outputVolume} max={200} onChange={(v) => devicePrefs.set({ outputVolume: v })} />
      {prefs.outputVolume > 100 && <p className="-mt-2 text-xs text-white/45">Boosted above 100% — a limiter keeps it from distorting.</p>}

      {call.canVideo && list.cameras.length > 0 && (
        <DeviceSelect
          label="Camera"
          icon={<VideoIcon className="size-4" />}
          value={call.camOn ? call.cameraId : liveChoice("camera")}
          options={list.cameras}
          defaultOption={!call.camOn}
          onPick={(id) => devicePrefs.set({ camera: id })}
        />
      )}
      {call.canVideo && <QualityPicker value={prefs.videoQuality} />}
      {call.canVideo && canShareScreen && (
        <div className="space-y-1 border-t border-white/10 pt-3">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
            <ScreenShareIcon className="size-4" />
            Screen sharing
          </span>
          <span className="flex rounded-xl bg-white/10 p-1" role="radiogroup" aria-label="Screen sharing optimized for">
            {(
              [
                ["motion", "Videos & music"],
                ["detail", "Text & slides"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={prefs.shareMode === v}
                onClick={() => devicePrefs.set({ shareMode: v })}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${prefs.shareMode === v ? "bg-white text-zinc-900" : "text-white/75 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </span>
          <PanelToggle label="Share the sound too (tab audio)" checked={prefs.shareAudio} onChange={() => devicePrefs.set({ shareAudio: !prefs.shareAudio })} />
          {call.screenSharing && <p className="px-1 text-xs text-white/45">Sound changes apply next time you start sharing.</p>}
        </div>
      )}
      <PanelToggle
        label="Push-to-talk (hold Space or the mic button)"
        checked={prefs.pushToTalk}
        onChange={() => devicePrefs.set({ pushToTalk: !prefs.pushToTalk })}
      />
      {call.canVideo && (
        <PanelToggle label="Mirror my camera (only on my screen)" checked={prefs.mirror} onChange={() => devicePrefs.set({ mirror: !prefs.mirror })} />
      )}
      <p className="text-xs text-white/45">Shortcuts: M mute · V camera · Space push-to-talk · Esc close. Choices are saved on this device.</p>
    </div>
  );
}

function DeviceSelect({
  label,
  icon,
  value,
  options,
  defaultOption,
  onPick,
  extra,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  options: DeviceOption[];
  /** Offer "System default" as a choice. */
  defaultOption?: boolean;
  onPick: (id: string) => void;
  extra?: ReactNode;
}) {
  const known = options.some((o) => o.id === value);
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
        {icon}
        {label}
      </span>
      <span className="flex gap-2">
        <select
          value={known ? value : ""}
          onChange={(e) => onPick(e.target.value)}
          className="h-10 w-full min-w-0 rounded-xl bg-white/10 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-emerald-400 [&>option]:bg-zinc-900"
        >
          {(defaultOption || !known) && <option value="">System default</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {extra}
      </span>
    </label>
  );
}

function RangeRow({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-medium text-white/60">
        <span className="truncate">{label}</span>
        <span className="text-white tabular-nums">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-400"
        aria-valuetext={`${value}%`}
      />
    </label>
  );
}

function SoundTab({ call, voice, onChange }: { call: CallState; voice: VoiceSettings; onChange: (patch: Partial<VoiceSettings>) => void }) {
  const running = call.voiceMode;
  return (
    <div className="pt-1">
      <p className="mb-2 text-xs text-white/60">
        Changes apply instantly{running && running !== voice.noiseSuppression ? " · AI isn't available in this browser" : ""}
      </p>
      <div className="space-y-1.5" role="radiogroup" aria-label="Noise suppression mode">
        {MODES.map(([value, title, hint]) => {
          const selected = voice.noiseSuppression === value;
          return (
            <button
              key={value}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ noiseSuppression: value })}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                selected ? "bg-white/15 ring-1 ring-white/25" : "hover:bg-white/5"
              }`}
            >
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ring-2 ${selected ? "ring-emerald-400" : "ring-white/30"}`}>
                {selected && <span className="size-2.5 rounded-full bg-emerald-400" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {title}
                  {value === "ai" && selected && call.voiceEngine && (
                    <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase">
                      {call.voiceEngine === "gtcrn" ? "Max quality" : "Battery saver"}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-white/55">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {voice.noiseSuppression === "ai" && <AiEnginePicker />}
      <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
        <PanelToggle label="Echo cancellation" checked={voice.echoCancellation} onChange={() => onChange({ echoCancellation: !voice.echoCancellation })} />
        <PanelToggle label="Automatic gain control" checked={voice.autoGainControl} onChange={() => onChange({ autoGainControl: !voice.autoGainControl })} />
        <PanelToggle label="Noise gate (silence between words)" checked={voice.noiseGate} onChange={() => onChange({ noiseGate: !voice.noiseGate })} />
        <VoiceIsolationToggle />
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <AudioQualityPicker />
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <PanelToggle
          label="Clean up their voice too"
          checked={voice.cleanIncoming}
          onChange={() => onChange({ cleanIncoming: !voice.cleanIncoming })}
        />
        <p className="px-1 text-xs text-white/55">
          {voice.cleanIncoming && !call.incomingCleaned && call.remoteStream
            ? "Not available in this browser — you're hearing their normal audio"
            : "Removes noise from the other person's audio, on your device"}
        </p>
      </div>
    </div>
  );
}

function PanelToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1.5 text-left text-sm"
    >
      <span className="text-white/85">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-emerald-500" : "bg-white/20"}`}>
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

// ---------- Building blocks ----------

function ControlButton({
  label,
  onClick,
  disabled,
  active,
  badge,
  ring,
  onHold,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
  /** Green ring: you're talking. */
  ring?: boolean;
  /** Press-and-hold behaviour (push-to-talk). */
  onHold?: (held: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={
        onHold
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onHold(true);
            }
          : undefined
      }
      onPointerUp={onHold ? () => onHold(false) : undefined}
      onPointerCancel={onHold ? () => onHold(false) : undefined}
      onContextMenu={onHold ? (e) => e.preventDefault() : undefined}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`relative flex size-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 sm:size-14 ${
        active ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
      } ${ring ? "ring-2 ring-emerald-400" : ""}`}
    >
      {children}
      {badge && (
        <span
          className={`absolute -top-1 -right-1 rounded-full px-1.5 py-0.5 text-[9px] leading-none font-bold tracking-wide shadow ${
            badge === "OFF" ? "bg-zinc-600 text-white" : "bg-emerald-500 text-white"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function BigAction({ label, color, onClick, children }: { label: string; color: string; onClick: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        aria-label={label}
        className={`flex size-[72px] items-center justify-center rounded-full shadow-xl transition active:scale-95 ${color}`}
      >
        {children}
      </button>
      <span className="text-sm font-medium text-white/85">{label}</span>
    </div>
  );
}

function GlassButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-11 shrink-0 items-center justify-center rounded-full backdrop-blur-md transition ${active ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"}`}
    >
      {children}
    </button>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs text-white/85 backdrop-blur-md">
      {icon}
      {children}
    </span>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Your camera window. Drag it anywhere; it snaps to the nearest corner. */
function DraggablePip({ children, speaking }: { children: ReactNode; speaking?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<"tl" | "tr" | "bl" | "br">("tr");
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    const cx = e.clientX < window.innerWidth / 2 ? "l" : "r";
    const cy = e.clientY < window.innerHeight / 2 ? "t" : "b";
    setCorner(`${cy}${cx}` as typeof corner);
    setPos(null);
  };

  const cornerClass = {
    tl: "top-20 left-4",
    tr: "top-20 right-4",
    bl: "bottom-32 left-4",
    br: "bottom-32 right-4",
  }[corner];

  return (
    <div
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={`absolute z-20 aspect-[3/4] w-28 cursor-grab touch-none overflow-hidden rounded-3xl bg-zinc-800 shadow-2xl active:cursor-grabbing md:w-44 ${
        speaking ? "ring-[3px] ring-emerald-400" : "ring-2 ring-white/20"
      } ${pos ? "" : `${cornerClass} transition-all duration-300 ease-out`}`}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      aria-label="Your camera (drag to move)"
    >
      {children}
    </div>
  );
}

/** "Tap to hear the call" — when the browser wouldn't start the sound on its own. */
function SoundBlocked({ onTap, floating }: { onTap: () => void; floating?: boolean }) {
  return (
    <button
      onClick={onTap}
      className={`pop-in z-[60] mx-auto flex w-fit items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 shadow-2xl ${
        floating ? "fixed inset-x-0 bottom-24" : "relative mt-3"
      }`}
    >
      <VolumeIcon className="size-4" /> Tap to hear the call
    </button>
  );
}

function VoiceIsolationToggle() {
  const prefs = useDevicePrefs();
  if (!voiceIsolationSupported) return null;
  return (
    <PanelToggle
      label="Voice isolation (your device's own voice filter)"
      checked={prefs.voiceIsolation}
      onChange={() => devicePrefs.set({ voiceIsolation: !prefs.voiceIsolation })}
    />
  );
}

/** Which AI filter: the heavy one can stutter on a weaker laptop, the light one never does. */
function AiEnginePicker() {
  const prefs = useDevicePrefs();
  const options: [AiEnginePref, string][] = [
    ["auto", "Auto"],
    ["gtcrn", "Max quality"],
    ["rnnoise", "Light"],
  ];
  return (
    <div className="mt-3">
      <span className="mb-1.5 block text-xs font-medium text-white/60">AI filter · pick Light if your voice sounds choppy</span>
      <span className="flex rounded-xl bg-white/10 p-1" role="radiogroup" aria-label="AI filter">
        {options.map(([v, label]) => (
          <button
            key={v}
            role="radio"
            aria-checked={prefs.aiEngine === v}
            onClick={() => devicePrefs.set({ aiEngine: v })}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${prefs.aiEngine === v ? "bg-white text-zinc-900" : "text-white/75 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

const AUDIO_QUALITIES: [AudioQuality, string][] = [
  ["auto", "Clear"],
  ["high", "Studio"],
  ["saver", "Data saver"],
];

function AudioQualityPicker() {
  const prefs = useDevicePrefs();
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-white/60">Voice quality I send</span>
      <span className="flex rounded-xl bg-white/10 p-1" role="radiogroup" aria-label="Voice quality">
        {AUDIO_QUALITIES.map(([v, label]) => (
          <button
            key={v}
            role="radio"
            aria-checked={prefs.audioQuality === v}
            onClick={() => devicePrefs.set({ audioQuality: v })}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${prefs.audioQuality === v ? "bg-white text-zinc-900" : "text-white/75 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

const QUALITIES: [VideoQuality, string][] = [
  ["auto", "Auto"],
  ["hd", "HD"],
  ["saver", "Data saver"],
];

function QualityPicker({ value }: { value: VideoQuality }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-white/60">Video quality I send</span>
      <span className="flex rounded-xl bg-white/10 p-1" role="radiogroup" aria-label="Video quality">
        {QUALITIES.map(([v, label]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => devicePrefs.set({ videoQuality: v })}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${value === v ? "bg-white text-zinc-900" : "text-white/75 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

const QUICK_REPLIES = [
  "Can't talk right now. Call you later?",
  "I'll call you back in a few minutes.",
  "I'm in a meeting 🙏",
  "Text me instead 🙂",
];

/** Decline a call with a message, like on a phone. */
function QuickReplies({ roomId }: { roomId: string }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const reply = (text: string) => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    calls.decline();
    // The call screen closes straight away; the message follows a moment later.
    sendToRoom(roomId, { kind: "text", body }).catch(() => {
      // Offline: nothing more we can do from a closed call screen.
    });
  };
  return (
    <div className="pop-in w-full space-y-1 rounded-3xl bg-zinc-900/85 p-2 ring-1 ring-white/10 backdrop-blur-xl">
      {QUICK_REPLIES.map((t) => (
        <button
          key={t}
          disabled={busy}
          onClick={() => reply(t)}
          className="block w-full rounded-2xl px-3 py-2.5 text-left text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-50"
        >
          {t}
        </button>
      ))}
      <form
        className="flex gap-2 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          reply(custom);
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Write your own…"
          aria-label="Your message"
          maxLength={500}
          className="h-10 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-sm text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-emerald-400"
        />
        <button disabled={busy || !custom.trim()} className="shrink-0 rounded-full bg-emerald-600 px-4 text-sm font-semibold disabled:opacity-40">
          Send
        </button>
      </form>
    </div>
  );
}
