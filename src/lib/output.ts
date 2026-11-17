import { canPickSpeaker, devicePrefs, liveChoice, refreshDevices, type DeviceList, type DeviceOption } from "./devices";

/**
 * Where sound comes out, on every platform.
 *
 * Browsers do this in three different ways, so Relay uses whichever one works:
 *  - "sink":  Chrome/Edge/Firefox on computers and Safari 18.4+ on iPhone/iPad/Mac
 *             can send sound to a chosen speaker (setSinkId).
 *  - "route": Android browsers can't pick a speaker, but they list the phone's
 *             audio routes as microphones ("Speakerphone", "Headset earpiece",
 *             "Bluetooth headset"). Choosing one switches BOTH the mic and the
 *             speaker, because Android moves call audio as one route.
 *  - "system": nothing to pick from the page; the device decides (and Relay says how
 *             to change it there).
 */

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
export const isAndroid = /Android/i.test(ua);
/** iPadOS reports itself as a Mac, but with touch. */
export const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
export const isMobile = isAndroid || isIOS;

export type OutputMethod = "sink" | "route" | "system";
export const outputMethod: OutputMethod = isAndroid && !canPickSpeaker ? "route" : canPickSpeaker ? "sink" : "system";

export type OutputKind = "speaker" | "earpiece" | "bluetooth" | "wired" | "usb" | "airplay" | "other";

export interface OutputChoice extends DeviceOption {
  kind: OutputKind;
  /** A friendlier name for the phone routes ("Phone earpiece" instead of "Headset earpiece"). */
  name: string;
}

function classify(label: string): OutputKind {
  const l = label.toLowerCase();
  if (/earpiece|receiver|handset|iphone$|^iphone\b/.test(l)) return "earpiece";
  if (/bluetooth|airpods|buds|\bbt\b|beats|jabra|bose|sony wh|wf-/.test(l)) return "bluetooth";
  if (/airplay/.test(l)) return "airplay";
  if (/usb/.test(l)) return "usb";
  if (/wired|headphone|headset|aux|jack/.test(l)) return "wired";
  if (/speaker/.test(l)) return "speaker";
  return "other";
}

const FRIENDLY: Partial<Record<OutputKind, string>> = {
  speaker: "Loudspeaker",
  earpiece: "Phone earpiece",
  wired: "Wired headphones",
  usb: "USB headset",
};

/** The outputs you can choose between right now ([] = the system decides). */
export function outputChoices(list: DeviceList): OutputChoice[] {
  if (outputMethod === "sink") {
    return list.speakers.map((o) => ({ ...o, kind: classify(o.label), name: o.label }));
  }
  if (outputMethod === "route") {
    return list.mics.map((o) => {
      const kind = classify(o.label);
      // Keep Bluetooth names ("Galaxy Buds2"), translate Android's generic route names.
      const generic = /^(speakerphone|headset earpiece|wired headset|usb headset|bluetooth headset)$/i.test(o.label);
      return { ...o, kind, name: generic ? (FRIENDLY[kind] ?? o.label) : o.label };
    });
  }
  return [];
}

/** The output picked right now ("" = the system default). */
export function currentOutput(): string {
  return outputMethod === "route" ? liveChoice("mic") : outputMethod === "sink" ? liveChoice("speaker") : "";
}

export function pickOutput(id: string) {
  if (outputMethod === "route") devicePrefs.set({ mic: id });
  else if (outputMethod === "sink") devicePrefs.set({ speaker: id });
}

/** Firefox can show its own "choose a speaker" dialog (it only lists speakers you've allowed there). */
export const canAskForSpeaker =
  typeof navigator !== "undefined" && !!(navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })?.selectAudioOutput;

export async function askForSpeaker(): Promise<void> {
  const md = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
  const d = await md.selectAudioOutput!();
  await refreshDevices();
  devicePrefs.set({ speaker: d.deviceId });
}

/** Safari's AirPlay / Bluetooth route picker (iPhone, iPad, Mac). */
type WebkitMedia = HTMLMediaElement & { webkitShowPlaybackTargetPicker?: () => void };
export const canShowRoutePicker = typeof HTMLMediaElement !== "undefined" && "webkitShowPlaybackTargetPicker" in HTMLMediaElement.prototype;

let pickerEl: HTMLAudioElement | null = null;
export function showRoutePicker(el?: HTMLMediaElement | null) {
  const target = (el ?? (pickerEl ??= Object.assign(new Audio(), { src: silentWav() }))) as WebkitMedia;
  target.setAttribute("x-webkit-airplay", "allow");
  target.webkitShowPlaybackTargetPicker?.();
}

function silentWav() {
  const b = new Uint8Array([
    82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0,
    0, 0,
  ]);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}

/**
 * Some browsers ignore a media element's volume (iPhone and iPad: it's always
 * 100%, only the side buttons change it). There, and for boosting above 100%,
 * call audio runs through a Web Audio volume knob instead.
 */
export const elementVolumeWorks = (() => {
  if (typeof Audio === "undefined") return true;
  if (isIOS) return false;
  try {
    const a = new Audio();
    a.volume = 0.5;
    return Math.abs(a.volume - 0.5) < 0.01;
  } catch {
    return false;
  }
})();

/**
 * Call audio goes through Web Audio first when: the volume is boosted above 100%,
 * the browser ignores element volume, or it's Safari on iPhone/iPad, where a chosen
 * speaker is ignored for raw WebRTC audio but works once it passes through Web Audio.
 */
export function needsAudioRelay(volume: number): boolean {
  return volume > 100 || !elementVolumeWorks || (isIOS && canPickSpeaker);
}

/** What to tell people when there's nothing to pick on this device. */
export function systemOutputHint(): string {
  if (isIOS) {
    return canShowRoutePicker
      ? "Choose AirPods, a Bluetooth speaker or the iPhone itself with the button below, or from Control Center (long-press the sound tile)."
      : "Choose AirPods, a Bluetooth speaker or the iPhone itself from Control Center (long-press the sound tile).";
  }
  if (isAndroid)
    return "Headphones and Bluetooth take over automatically when connected. Allow the microphone to choose between loudspeaker, earpiece and Bluetooth.";
  return "This browser plays sound on your system's speaker — change it in your computer's sound settings.";
}

export const OUTPUT_ICONS: Record<OutputKind, string> = {
  speaker: "🔊",
  earpiece: "📱",
  bluetooth: "🎧",
  wired: "🎧",
  usb: "🎧",
  airplay: "📡",
  other: "🔈",
};
