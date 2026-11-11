import { useEffect, useRef } from "react";
import type { DeviceProblem } from "../lib/media";
import { MicOffIcon, XIcon } from "./ui";

function platform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/** Explains, step by step for the user's device, how to let Relay use the mic/camera. */
export function DeviceHelp({
  problem,
  device,
  onRetry,
  onClose,
}: {
  problem: DeviceProblem;
  device: "microphone" | "camera";
  onRetry?: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const os = platform();
  const what = device === "camera" ? "camera and microphone" : "microphone";
  let title = `Allow ${what} access`;
  let steps: string[] = [];

  switch (problem) {
    case "blocked":
      title = `Relay can't use your ${what}`;
      steps =
        os === "ios"
          ? [
              "In Safari, tap the “aA” button on the left of the address bar.",
              `Tap “Website Settings” and set ${device === "camera" ? "Camera and Microphone" : "Microphone"} to “Allow”.`,
              `Also check iPhone Settings → Safari → ${device === "camera" ? "Camera / Microphone" : "Microphone"} → “Ask” or “Allow”.`,
              "Come back and try again.",
            ]
          : os === "android"
            ? [
                "In Chrome, tap the icon on the left of the address bar (🔒 or ⚙).",
                `Tap “Permissions” and turn on ${device === "camera" ? "Camera and Microphone" : "Microphone"}.`,
                `If it's still blocked: Android Settings → Apps → Chrome → Permissions → ${device === "camera" ? "Camera / Microphone" : "Microphone"} → Allow.`,
                "Come back and try again.",
              ]
            : [
                "Click the 🔒 icon on the left of the address bar.",
                `Set ${device === "camera" ? "Camera and Microphone" : "Microphone"} to “Allow”.`,
                "Reload the page if your browser asks you to.",
              ];
      break;
    case "in-app":
      title = "Open Relay in your browser";
      steps = [
        "You're inside another app's built-in browser (like Instagram or Snapchat), which can't use the microphone or camera.",
        os === "ios" ? "Tap ••• or the share icon, then “Open in Safari”." : "Tap ⋮, then “Open in Chrome” (or your browser).",
      ];
      break;
    case "not-found":
      title = `No ${device} found`;
      steps = [`Make sure a ${device} is connected and not disabled, then try again.`];
      break;
    case "busy":
      title = `Your ${device} is busy`;
      steps = [`Another app is using your ${device} (a call or a recording). Close it and try again.`];
      break;
    case "insecure":
    case "unsupported":
      title = "Not supported here";
      steps = [
        `This browser can't use the ${device}.`,
        os === "ios" ? "Use Safari on iOS 14.3 or newer." : "Use a recent version of Chrome, Edge, Firefox or Safari.",
      ];
      break;
    default:
      title = `Couldn't start the ${device}`;
      steps = ["Something went wrong. Try again, or reload the page."];
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100"
      aria-labelledby="device-help-title"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
            <MicOffIcon className="size-5" />
          </span>
          <button
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        <h2 id="device-help-title" className="mt-3 text-lg font-semibold">
          {title}
        </h2>
        <ol className="mt-3 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              {steps.length > 1 && (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent-fg">
                  {i + 1}
                </span>
              )}
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => dialogRef.current?.close()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Close
          </button>
          {onRetry && (problem === "blocked" || problem === "busy" || problem === "not-found" || problem === "other") && (
            <button
              onClick={() => {
                dialogRef.current?.close();
                onRetry();
              }}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:opacity-90"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
