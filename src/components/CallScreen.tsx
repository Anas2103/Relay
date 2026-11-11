import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { User } from "../../shared/types";
import { calls } from "../lib/calls";
import { formatDuration } from "../lib/media";
import { DeviceHelp } from "./DeviceHelp";
import {
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
} from "./ui";

function useCall() {
  return useSyncExternalStore(calls.subscribe, calls.getState);
}

/**
 * Attaches a MediaStream to whichever <video>/<audio> element is currently
 * rendered (a callback ref re-runs when the element is swapped, e.g. the camera
 * preview moving into the picture-in-picture window).
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

export function CallScreen({ peer }: { peer: User | null }) {
  const call = useCall();
  const [minimized, setMinimized] = useState(false);
  const [now, setNow] = useState(Date.now());
  const remoteVideo = useStream<HTMLVideoElement>(call.remoteStream);
  const remoteAudio = useStream<HTMLAudioElement>(call.video ? null : call.remoteStream);
  const localVideo = useStream<HTMLVideoElement>(call.localStream);

  useEffect(() => {
    if (call.phase !== "active") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [call.phase]);

  useEffect(() => {
    if (call.phase === "idle" || call.phase === "incoming") setMinimized(false);
  }, [call.phase]);

  if (call.phase === "idle") return null;

  const name = call.peerName || peer?.displayName || "Unknown";
  const seed = call.peerId ?? "call";
  const elapsed = call.connectedAt ? formatDuration((now - call.connectedAt) / 1000) : null;
  const showRemoteVideo = call.video && call.phase === "active" && call.peerCamOn && !!call.remoteStream;
  const showLocalVideo = call.video && call.camOn && !!call.localStream;
  const statusText =
    call.phase === "incoming"
      ? `Incoming ${call.video ? "video" : "voice"} call`
      : call.phase === "outgoing"
        ? "Calling…"
        : call.phase === "connecting"
          ? "Connecting…"
          : call.phase === "ended"
            ? (call.endReason ?? "Call ended")
            : call.reconnecting
              ? "Reconnecting…"
              : elapsed;

  // Hidden media elements keep playing while the call is minimized.
  const media = (
    <>
      <audio ref={remoteAudio} autoPlay playsInline className="hidden" />
    </>
  );

  if (minimized && call.phase !== "ended") {
    return (
      <>
        {media}
        <video ref={remoteVideo} autoPlay playsInline className="hidden" />
        <video ref={localVideo} autoPlay playsInline muted className="hidden" />
        <button
          onClick={() => setMinimized(false)}
          className="pop-in fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <span className="record-pulse size-2 rounded-full bg-white" />
          {name} · {statusText} — tap to return
        </button>
      </>
    );
  }

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex flex-col overflow-hidden bg-zinc-950 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${call.video ? "Video" : "Voice"} call with ${name}`}
    >
      {media}

      {/* Background: remote video, or my camera preview while ringing, or a soft gradient */}
      {showRemoteVideo ? (
        <video ref={remoteVideo} autoPlay playsInline className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <video ref={remoteVideo} autoPlay playsInline className="hidden" />
          {call.video && call.phase !== "active" && showLocalVideo ? (
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 size-full object-cover opacity-60 ${call.facing === "user" ? "-scale-x-100" : ""}`}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-b from-accent/60 via-zinc-900 to-zinc-950" />
          )}
        </>
      )}

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between p-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
        {call.phase !== "incoming" && call.phase !== "ended" ? (
          <button
            onClick={() => setMinimized(true)}
            className="rounded-full bg-black/30 p-2 backdrop-blur transition hover:bg-black/50"
            aria-label="Minimize call"
            title="Keep chatting"
          >
            <ChevronDownIcon className="size-5" />
          </button>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-xs backdrop-blur">
          🔒 End-to-end encrypted
        </span>
        <span className="size-9" />
      </div>

      {/* Who + status (hidden behind full-screen video once it's flowing) */}
      {!showRemoteVideo && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className={call.phase === "incoming" || call.phase === "outgoing" ? "animate-pulse" : ""}>
            <Avatar name={name} seed={seed} user={peer} size="xl" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">{name}</h2>
          <p className="mt-1 flex items-center gap-2 text-white/80 tabular-nums">
            {(call.phase === "connecting" || call.reconnecting) && <Spinner className="size-4" />}
            {statusText}
          </p>
          {call.phase === "active" && call.video && !call.peerCamOn && (
            <p className="mt-2 text-sm text-white/60">{name}'s camera is off</p>
          )}
          {call.phase === "active" && !call.peerMicOn && <p className="mt-2 text-sm text-white/60">{name} is muted</p>}
        </div>
      )}

      {showRemoteVideo && (
        <div className="relative z-10 flex-1">
          <div className="absolute top-0 left-4 rounded-xl bg-black/30 px-3 py-1.5 backdrop-blur">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-white/80 tabular-nums">{statusText}</p>
          </div>
        </div>
      )}

      {/* My camera, picture-in-picture */}
      {call.phase === "active" && call.video && (
        <div className="absolute right-4 bottom-32 z-20 aspect-[3/4] w-28 overflow-hidden rounded-2xl bg-zinc-800 shadow-2xl ring-1 ring-white/20 md:w-40">
          {showLocalVideo ? (
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className={`size-full object-cover ${call.facing === "user" ? "-scale-x-100" : ""}`}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-white/60">
              <VideoOffIcon className="size-6" />
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="relative z-10 flex justify-center gap-5 p-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
        {call.phase === "incoming" ? (
          <>
            <RoundButton label="Decline" color="bg-red-600 hover:bg-red-500" onClick={() => calls.decline()}>
              <PhoneOffIcon className="size-7" />
            </RoundButton>
            <RoundButton label="Accept" color="bg-emerald-600 hover:bg-emerald-500" onClick={() => calls.accept()} big>
              {call.video ? <VideoIcon className="size-7" /> : <PhoneIcon className="size-7" />}
            </RoundButton>
          </>
        ) : call.phase === "ended" ? (
          <RoundButton label="Close" color="bg-white/15 hover:bg-white/25" onClick={() => calls.dismiss()}>
            <PhoneOffIcon className="size-7" />
          </RoundButton>
        ) : (
          <>
            <RoundButton
              label={call.micOn ? "Mute" : "Unmute"}
              color={call.micOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-zinc-900"}
              onClick={() => calls.toggleMic()}
              disabled={!call.localStream}
            >
              {call.micOn ? <MicIcon className="size-6" /> : <MicOffIcon className="size-6" />}
            </RoundButton>
            {call.video && (
              <RoundButton
                label={call.camOn ? "Turn camera off" : "Turn camera on"}
                color={call.camOn ? "bg-white/15 hover:bg-white/25" : "bg-white text-zinc-900"}
                onClick={() => calls.toggleCam()}
                disabled={!call.localStream}
              >
                {call.camOn ? <VideoIcon className="size-6" /> : <VideoOffIcon className="size-6" />}
              </RoundButton>
            )}
            {call.video && (
              <RoundButton
                label="Switch camera"
                color="bg-white/15 hover:bg-white/25"
                onClick={() => calls.switchCamera()}
                disabled={!call.localStream || !call.camOn}
              >
                <SwitchCameraIcon className="size-6" />
              </RoundButton>
            )}
            <RoundButton label="End call" color="bg-red-600 hover:bg-red-500" onClick={() => calls.hangUp()}>
              <PhoneOffIcon className="size-7" />
            </RoundButton>
          </>
        )}
      </div>

      {call.problem && call.phase === "ended" && (
        <DeviceHelp problem={call.problem} device={call.video ? "camera" : "microphone"} onClose={() => calls.dismiss()} />
      )}
    </div>
  );
}

function RoundButton({
  label,
  color,
  onClick,
  disabled,
  big,
  children,
}: {
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex items-center justify-center rounded-full shadow-lg transition active:scale-95 disabled:opacity-40 ${color} ${
          big ? "size-16 ring-8 ring-emerald-500/25" : "size-16"
        }`}
      >
        {children}
      </button>
      <span className="text-xs text-white/80">{label}</span>
    </div>
  );
}
