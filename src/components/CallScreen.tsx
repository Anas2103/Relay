import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import type { NoiseSuppression, Settings, User } from "../../shared/types";
import { avatarUrl } from "../lib/api";
import { calls, type CallState } from "../lib/calls";
import { formatDuration } from "../lib/media";
import { DeviceHelp } from "./DeviceHelp";
import {
  AudioLinesIcon,
  Avatar,
  ChevronDownIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
  Spinner,
  SwitchCameraIcon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "./ui";

type VoiceSettings = Pick<Settings, "noiseSuppression" | "echoCancellation" | "autoGainControl" | "noiseGate">;

function useCall() {
  return useSyncExternalStore(calls.subscribe, calls.getState);
}

/**
 * Attaches a MediaStream to whichever <video>/<audio> element is rendered
 * (a callback ref re-runs when the element is swapped, e.g. full screen ↔ minimized).
 */
function useStream<T extends HTMLMediaElement>(stream: MediaStream | null) {
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      if (stream) el.play().catch(() => {});
    },
    [stream],
  );
}

function useTimer(call: CallState) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (call.phase !== "active") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [call.phase]);
  return call.connectedAt ? formatDuration((now - call.connectedAt) / 1000) : null;
}

function statusText(call: CallState, elapsed: string | null) {
  switch (call.phase) {
    case "incoming":
      return `Incoming ${call.video ? "video" : "voice"} call…`;
    case "outgoing":
      return "Calling…";
    case "connecting":
      return "Connecting…";
    case "ended":
      return call.endReason ?? "Call ended";
    default:
      return call.reconnecting ? "Reconnecting…" : (elapsed ?? "");
  }
}

export function CallScreen({
  peer,
  voice,
  onVoiceChange,
}: {
  peer: User | null;
  voice: VoiceSettings;
  onVoiceChange: (patch: Partial<VoiceSettings>) => void;
}) {
  const call = useCall();
  const [minimized, setMinimized] = useState(false);
  const [noiseOpen, setNoiseOpen] = useState(false);
  const elapsed = useTimer(call);
  // Remote audio always plays through one hidden <audio> element; every <video> is muted,
  // so switching layouts never doubles or cuts the sound.
  const remoteAudio = useStream<HTMLAudioElement>(call.remoteStream);
  const remoteVideo = useStream<HTMLVideoElement>(call.remoteStream);
  const localVideo = useStream<HTMLVideoElement>(call.localStream);

  useEffect(() => {
    if (call.phase === "idle" || call.phase === "incoming") {
      setMinimized(false);
      setNoiseOpen(false);
    }
  }, [call.phase]);

  // Make room for the minimized call bar so it never covers the app.
  const barShown = minimized && call.phase !== "ended" && call.phase !== "idle";
  useEffect(() => {
    document.documentElement.style.setProperty("--call-bar", barShown ? "calc(112px + env(safe-area-inset-top))" : "0px");
    return () => document.documentElement.style.setProperty("--call-bar", "0px");
  }, [barShown]);

  if (call.phase === "idle") return null;

  const name = call.peerName || peer?.displayName || "Unknown";
  const seed = call.peerId ?? "call";
  const status = statusText(call, elapsed);
  const remoteVideoOn = call.video && call.phase === "active" && call.peerCamOn && !!call.remoteStream;
  const localVideoOn = call.video && call.camOn && !!call.localStream;
  const live = call.phase !== "incoming" && call.phase !== "ended";

  const audio = <audio ref={remoteAudio} autoPlay playsInline className="hidden" />;

  // ---------- Minimized: a big floating card, tap anywhere to return ----------
  if (minimized && call.phase !== "ended") {
    return (
      <>
        {audio}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setMinimized(false)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setMinimized(false)}
          aria-label={`Return to call with ${name}`}
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
          className="slide-up fixed inset-x-3 z-50 mx-auto flex h-[88px] max-w-xl cursor-pointer items-center gap-3 overflow-hidden rounded-3xl bg-zinc-900 p-3 text-white shadow-2xl ring-1 ring-white/10"
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-zinc-800">
            {remoteVideoOn ? (
              <video ref={remoteVideo} autoPlay playsInline muted className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Avatar name={name} seed={seed} user={peer} size="lg" />
              </div>
            )}
            <span className="absolute right-1 bottom-1 size-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-900" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name}</p>
            <p className="flex items-center gap-1.5 text-sm text-emerald-300 tabular-nums">
              {call.reconnecting && <Spinner className="size-3" />}
              {status}
            </p>
            <p className="text-xs text-white/50">Tap to return to the call</p>
          </div>
          <MiniButton
            label={call.micOn ? "Mute" : "Unmute"}
            active={!call.micOn}
            onClick={() => calls.toggleMic()}
          >
            {call.micOn ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
          </MiniButton>
          <MiniButton label="End call" danger onClick={() => calls.hangUp()}>
            <PhoneOffIcon className="size-6" />
          </MiniButton>
        </div>
      </>
    );
  }

  // ---------- Full screen ----------
  const picture = peer ? avatarUrl(peer) : null;

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`${call.video ? "Video" : "Voice"} call with ${name}`}
    >
      {audio}

      {/* Backdrop: their video, my camera preview while ringing, or a soft glow made from their picture */}
      {remoteVideoOn ? (
        <video ref={remoteVideo} autoPlay playsInline muted className="absolute inset-0 size-full object-cover" />
      ) : call.video && call.phase !== "active" && localVideoOn ? (
        <>
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 size-full scale-105 object-cover opacity-50 blur-sm ${call.facing === "user" ? "-scale-x-105" : ""}`}
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
        {live ? (
          <GlassButton label="Minimize — keep chatting" onClick={() => setMinimized(true)}>
            <ChevronDownIcon className="size-5" />
          </GlassButton>
        ) : (
          <span className="size-11" />
        )}
        {remoteVideoOn ? (
          <div className="min-w-0 rounded-2xl bg-black/35 px-4 py-1.5 text-center backdrop-blur-md">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-xs text-white/75 tabular-nums">{status}</p>
          </div>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
            <LockGlyph /> End-to-end encrypted
          </span>
        )}
        <span className="size-11" />
      </div>

      {call.reconnecting && (
        <div className="relative z-20 mx-auto mt-3 flex items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-amber-950">
          <Spinner className="size-3" /> Weak connection — reconnecting…
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
            <div className="relative rounded-full p-1.5 ring-1 ring-white/20">
              <Avatar name={name} seed={seed} user={peer} size="xl" />
            </div>
          </div>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight">{name}</h2>
          <p className="mt-2 flex items-center gap-2 text-base text-white/75 tabular-nums">
            {call.phase === "connecting" && <Spinner className="size-4" />}
            {status}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {call.phase === "active" && call.video && !call.peerCamOn && <Chip icon={<VideoOffIcon className="size-3.5" />}>Camera off</Chip>}
            {call.phase === "active" && !call.peerMicOn && <Chip icon={<MicOffIcon className="size-3.5" />}>{name} is muted</Chip>}
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-end pb-4">
          {!call.peerMicOn && <Chip icon={<MicOffIcon className="size-3.5" />}>{name} is muted</Chip>}
        </div>
      )}

      {/* My camera: picture-in-picture, drag it to any corner */}
      {call.phase === "active" && call.video && (
        <DraggablePip>
          {localVideoOn ? (
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className={`size-full object-cover ${call.facing === "user" ? "-scale-x-100" : ""}`}
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1 bg-zinc-800 text-white/60">
              <VideoOffIcon className="size-6" />
              <span className="text-[11px]">Camera off</span>
            </div>
          )}
          {!call.micOn && (
            <span className="absolute top-2 left-2 rounded-full bg-black/55 p-1">
              <MicOffIcon className="size-3.5" />
            </span>
          )}
        </DraggablePip>
      )}

      {/* Noise suppression panel */}
      {noiseOpen && live && (
        <NoisePanel call={call} voice={voice} onChange={onVoiceChange} onClose={() => setNoiseOpen(false)} />
      )}

      {/* Controls */}
      <div
        className="relative z-20 flex justify-center px-4 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {call.phase === "incoming" ? (
          <div className="slide-up flex w-full max-w-sm items-start justify-around">
            <BigAction label="Decline" color="bg-red-600 hover:bg-red-500" onClick={() => calls.decline()}>
              <PhoneOffIcon className="size-8" />
            </BigAction>
            <BigAction label="Accept" color="accept-pulse bg-emerald-600 hover:bg-emerald-500" onClick={() => calls.accept()}>
              {call.video ? <VideoIcon className="size-8" /> : <PhoneIcon className="size-8" />}
            </BigAction>
          </div>
        ) : call.phase === "ended" ? (
          <div className="slide-up flex flex-col items-center gap-3">
            <button
              onClick={() => calls.dismiss()}
              className="rounded-full bg-white/15 px-6 py-3 text-sm font-semibold backdrop-blur-md transition hover:bg-white/25"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="slide-up flex items-center gap-2 rounded-full bg-white/10 p-2 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl sm:gap-3">
            <ControlButton
              label={call.micOn ? "Mute" : "Unmute"}
              active={!call.micOn}
              onClick={() => calls.toggleMic()}
              disabled={!call.localStream}
            >
              {call.micOn ? <MicIcon className="size-6" /> : <MicOffIcon className="size-6" />}
            </ControlButton>
            {call.video && (
              <ControlButton
                label={call.camOn ? "Turn camera off" : "Turn camera on"}
                active={!call.camOn}
                onClick={() => calls.toggleCam()}
                disabled={!call.localStream}
              >
                {call.camOn ? <VideoIcon className="size-6" /> : <VideoOffIcon className="size-6" />}
              </ControlButton>
            )}
            {call.video && (
              <ControlButton
                label="Switch camera"
                onClick={() => calls.switchCamera()}
                disabled={!call.localStream || !call.camOn}
              >
                <SwitchCameraIcon className="size-6" />
              </ControlButton>
            )}
            <ControlButton
              label="Noise suppression"
              active={noiseOpen}
              onClick={() => setNoiseOpen((o) => !o)}
              badge={modeBadge(call.voiceMode ?? voice.noiseSuppression)}
            >
              <AudioLinesIcon className="size-6" />
            </ControlButton>
            <button
              onClick={() => calls.hangUp()}
              aria-label="End call"
              title="End call"
              className="ml-1 flex h-14 w-20 items-center justify-center rounded-full bg-red-600 shadow-lg transition hover:bg-red-500 active:scale-95"
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

// ---------- In-call noise suppression panel ----------

const MODES: [NoiseSuppression, string, string][] = [
  ["ai", "AI noise suppression", "Removes fans, keyboards and background voices"],
  ["standard", "Standard", "Your browser's built-in filter"],
  ["off", "Off", "Raw microphone"],
];

function NoisePanel({
  call,
  voice,
  onChange,
  onClose,
}: {
  call: CallState;
  voice: VoiceSettings;
  onChange: (patch: Partial<VoiceSettings>) => void;
  onClose: () => void;
}) {
  const running = call.voiceMode;
  return (
    <div className="slide-up absolute inset-x-3 bottom-28 z-30 mx-auto max-w-md rounded-3xl bg-zinc-900/90 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:bottom-32">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">Noise suppression</p>
          <p className="text-xs text-white/60">
            Changes apply instantly{running && running !== voice.noiseSuppression ? " · AI isn't available in this browser" : ""}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <XIcon className="size-5" />
        </button>
      </div>
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
      <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
        <PanelToggle label="Echo cancellation" checked={voice.echoCancellation} onChange={() => onChange({ echoCancellation: !voice.echoCancellation })} />
        <PanelToggle label="Automatic gain control" checked={voice.autoGainControl} onChange={() => onChange({ autoGainControl: !voice.autoGainControl })} />
        <PanelToggle label="Noise gate (silence between words)" checked={voice.noiseGate} onChange={() => onChange({ noiseGate: !voice.noiseGate })} />
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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`relative flex size-14 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
        active ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
      }`}
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

function GlassButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function MiniButton({
  label,
  onClick,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation(); // don't also "return to call"
        onClick();
      }}
      aria-label={label}
      title={label}
      className={`flex size-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
        danger ? "bg-red-600 hover:bg-red-500" : active ? "bg-white text-zinc-900" : "bg-white/10 hover:bg-white/20"
      }`}
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
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Your camera window. Drag it anywhere; it snaps to the nearest corner. */
function DraggablePip({ children }: { children: ReactNode }) {
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
      className={`absolute z-20 aspect-[3/4] w-28 cursor-grab touch-none overflow-hidden rounded-3xl bg-zinc-800 shadow-2xl ring-2 ring-white/20 active:cursor-grabbing md:w-44 ${
        pos ? "" : `${cornerClass} transition-all duration-300 ease-out`
      }`}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      aria-label="Your camera (drag to move)"
    >
      {children}
    </div>
  );
}
