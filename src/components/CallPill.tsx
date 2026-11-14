import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { User } from "../../shared/types";
import { calls, type CallState } from "../lib/calls";
import { formatDuration } from "../lib/media";
import { Avatar, MicIcon, MicOffIcon, PhoneOffIcon, ScreenShareIcon, Spinner } from "./ui";

/*
 * The small, always-loaded part of the call UI: the call store hook and the
 * minimized call bar. The full call screen (CallScreen.tsx) loads on demand.
 */

export function useCall() {
  return useSyncExternalStore(calls.subscribe, calls.getState);
}


export function useTimer(call: CallState) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (call.phase !== "active") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [call.phase]);
  return call.connectedAt ? formatDuration((now - call.connectedAt) / 1000) : null;
}

export function statusText(call: CallState, elapsed: string | null) {
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


export function MiniButton({
  label,
  onClick,
  danger,
  active,
  small,
  children,
}: {
  small?: boolean;
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
      className={`flex shrink-0 items-center justify-center rounded-full transition active:scale-95 ${small ? "size-9" : "size-12"} ${
        danger ? "bg-red-600 hover:bg-red-500" : active ? "bg-white text-zinc-900" : "bg-white/20 hover:bg-white/30"
      }`}
    >
      {children}
    </button>
  );
}


/** Is a minimized call showing (so headers can make room for the pill)? */
export function useCallMinimized() {
  const call = useCall();
  return call.minimized && call.phase !== "idle" && call.phase !== "ended";
}

/**
 * The minimized call, living inside the chat (or sidebar) header: avatar, timer,
 * mute and hang up. Tap anywhere else on it to go back to the call.
 */
export function CallPill({ peer }: { peer: User | null }) {
  const call = useCall();
  const elapsed = useTimer(call);
  if (!call.minimized || call.phase === "idle" || call.phase === "ended") return null;
  const name = call.peerName || peer?.displayName || "Call";
  const status = statusText(call, elapsed);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => calls.setMinimized(false)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && calls.setMinimized(false)}
      aria-label={`Return to call with ${name}`}
      title="Return to the call"
      className="pop-in flex h-11 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-emerald-600 py-1 pr-1 pl-1 text-white shadow-md ring-1 ring-emerald-400/40 transition hover:bg-emerald-500"
    >
      <span className="relative shrink-0">
        <Avatar name={name} seed={call.peerId ?? "call"} user={peer} size="sm" />
        <span className="record-pulse absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-white ring-2 ring-emerald-600" />
      </span>
      <span className="hidden max-w-28 min-w-0 truncate text-sm font-medium lg:block">{name}</span>
      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
        {call.reconnecting && <Spinner className="size-3" />}
        {call.screenSharing && <ScreenShareIcon className="size-3.5" />}
        {status}
      </span>
      <MiniButton small label={call.micOn ? "Mute" : "Unmute"} active={!call.micOn} onClick={() => calls.toggleMic()}>
        {call.micOn ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
      </MiniButton>
      <MiniButton small label="End call" danger onClick={() => calls.hangUp()}>
        <PhoneOffIcon className="size-5" />
      </MiniButton>
    </div>
  );
}

