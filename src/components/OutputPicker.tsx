import { useState } from "react";
import { liveChoice, playTestSound, unlockDeviceNames } from "../lib/devices";
import {
  askForSpeaker,
  canAskForSpeaker,
  canShowRoutePicker,
  currentOutput,
  OUTPUT_ICONS,
  outputChoices,
  outputMethod,
  pickOutput,
  showRoutePicker,
  systemOutputHint,
} from "../lib/output";
import { useDeviceList, useDevicePrefs } from "../lib/useDevices";

/**
 * Where you hear the call. Adapts to what this device can do: a speaker list
 * (computers, iPhone), phone routes (Android: loudspeaker / earpiece / Bluetooth),
 * the browser's own pickers (Firefox, Safari AirPlay) — and says how to switch
 * on the device itself when the page can't.
 */
export function OutputPicker({ audioEl, light }: { audioEl: HTMLMediaElement | null; light?: boolean }) {
  const list = useDeviceList();
  const prefs = useDevicePrefs();
  const [busy, setBusy] = useState(false);
  const choices = outputChoices(list);
  const current = currentOutput();
  const known = choices.some((c) => c.id === current);
  const needsNames = outputMethod !== "system" && !list.labelled;
  const base = light
    ? "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
    : "bg-white/10 text-white hover:bg-white/15";
  const selectedCls = light ? "bg-[var(--accent)] text-white" : "bg-white text-zinc-900";
  const hint = light ? "text-zinc-500 dark:text-zinc-400" : "text-white/55";

  const row = (id: string, icon: string, name: string, sub?: string) => {
    const on = id === "" ? !known : current === id;
    return (
      <button
        key={id || "auto"}
        role="radio"
        aria-checked={on}
        onClick={() => pickOutput(id)}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition ${on ? selectedCls : base}`}
      >
        <span className="text-lg leading-none" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          {sub && <span className={`block truncate text-xs ${on ? "opacity-75" : "opacity-60"}`}>{sub}</span>}
        </span>
        {on && <span aria-hidden="true">✓</span>}
      </button>
    );
  };

  return (
    <div className="space-y-1.5">
      {choices.length > 0 && (
        <div className="space-y-1.5" role="radiogroup" aria-label="Sound output">
          {row("", "✨", "Automatic", outputMethod === "route" ? "Headphones and Bluetooth first" : "Your system's default")}
          {choices.map((c) => row(c.id, OUTPUT_ICONS[c.kind], c.name, c.name !== c.label ? c.label : undefined))}
        </div>
      )}
      {needsNames && (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void unlockDeviceNames(false)
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
          className={`w-full rounded-2xl px-3 py-2.5 text-sm font-medium transition disabled:opacity-50 ${base}`}
        >
          {busy ? "Asking…" : "Show speakers and headphones"}
        </button>
      )}
      {canAskForSpeaker && (
        <button onClick={() => void askForSpeaker().catch(() => {})} className={`w-full rounded-2xl px-3 py-2.5 text-sm font-medium transition ${base}`}>
          Choose another speaker…
        </button>
      )}
      {canShowRoutePicker && (
        <button onClick={() => showRoutePicker(audioEl)} className={`w-full rounded-2xl px-3 py-2.5 text-sm font-medium transition ${base}`}>
          📡 AirPlay &amp; Bluetooth…
        </button>
      )}
      {choices.length === 0 && !needsNames && <p className={`px-1 text-xs ${hint}`}>{systemOutputHint()}</p>}
      {outputMethod === "route" && choices.length > 0 && (
        <p className={`px-1 text-xs ${hint}`}>On Android, the microphone switches together with the speaker.</p>
      )}
      <button
        onClick={() => void playTestSound(liveChoice("speaker"), prefs.outputVolume).catch(() => {})}
        className={`w-full rounded-2xl px-3 py-2 text-xs font-medium transition ${base}`}
      >
        Play a test sound
      </button>
    </div>
  );
}
