/**
 * Microphone / camera / speaker choice, and the volume sliders.
 *
 * Device IDs only mean something on the device that produced them, so these
 * choices live in this browser (localStorage), not in the account settings
 * that sync everywhere.
 */

export interface DevicePrefs {
  /** "" = the system default. */
  mic: string;
  camera: string;
  speaker: string;
  /** Your microphone volume, in percent (0–200). */
  micVolume: number;
  /** How loud the other person is, in percent (0–100). */
  outputVolume: number;
  /** Show your own camera like a mirror (only on your screen; others always see you the right way round). */
  mirror: boolean;
  /** Answer video calls with your camera off. */
  joinCameraOff: boolean;
  /** Mic stays muted in calls except while you hold Space (or the mic button). */
  pushToTalk: boolean;
  /** How much video you send: "saver" for mobile data, "hd" for the sharpest picture. */
  videoQuality: VideoQuality;
  ringtone: Ringtone;
  /** Ringtone volume, in percent (0–100). */
  ringVolume: number;
}

export type VideoQuality = "auto" | "hd" | "saver";
export type Ringtone = "classic" | "marimba" | "digital" | "gentle" | "vibrate";
export const RINGTONES: [Ringtone, string][] = [
  ["classic", "Classic"],
  ["marimba", "Marimba"],
  ["digital", "Digital"],
  ["gentle", "Gentle"],
  ["vibrate", "Silent (vibrate only)"],
];

const KEY = "relay:devices";
const DEFAULTS: DevicePrefs = {
  mic: "",
  camera: "",
  speaker: "",
  micVolume: 100,
  outputVolume: 100,
  mirror: true,
  joinCameraOff: false,
  pushToTalk: false,
  videoQuality: "auto",
  ringtone: "classic",
  ringVolume: 80,
};

function load(): DevicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DevicePrefs>;
    const num = (v: unknown, d: number, max: number) => (typeof v === "number" && v >= 0 && v <= max ? v : d);
    return {
      mic: typeof raw.mic === "string" ? raw.mic : "",
      camera: typeof raw.camera === "string" ? raw.camera : "",
      speaker: typeof raw.speaker === "string" ? raw.speaker : "",
      micVolume: num(raw.micVolume, 100, 200),
      outputVolume: num(raw.outputVolume, 100, 100),
      mirror: typeof raw.mirror === "boolean" ? raw.mirror : true,
      joinCameraOff: typeof raw.joinCameraOff === "boolean" ? raw.joinCameraOff : false,
      pushToTalk: typeof raw.pushToTalk === "boolean" ? raw.pushToTalk : false,
      videoQuality: raw.videoQuality === "hd" || raw.videoQuality === "saver" ? raw.videoQuality : "auto",
      ringtone: RINGTONES.some(([r]) => r === raw.ringtone) ? (raw.ringtone as Ringtone) : "classic",
      ringVolume: num(raw.ringVolume, 80, 100),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: DevicePrefs = load();
const prefListeners = new Set<() => void>();

export const devicePrefs = {
  get: () => prefs,
  subscribe(fn: () => void) {
    prefListeners.add(fn);
    return () => void prefListeners.delete(fn);
  },
  set(patch: Partial<DevicePrefs>) {
    prefs = { ...prefs, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // private mode — keep it for this session
    }
    prefListeners.forEach((fn) => fn());
  },
};

// ---------- The list of plugged-in devices ----------

export interface DeviceOption {
  id: string;
  label: string;
}

export interface DeviceList {
  mics: DeviceOption[];
  cameras: DeviceOption[];
  speakers: DeviceOption[];
  /** Browsers hide device names until you've allowed the mic/camera once. */
  labelled: boolean;
}

const EMPTY: DeviceList = { mics: [], cameras: [], speakers: [], labelled: false };
let list: DeviceList = EMPTY;
const listListeners = new Set<(added: { kind: MediaDeviceKind; option: DeviceOption }[]) => void>();
let watching = false;

/** Can this browser send sound to a chosen speaker (Chrome, Edge, Firefox — not Safari)? */
export const canPickSpeaker = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

function clean(label: string) {
  // "Default - Speakers (Realtek(R) Audio)" → "Speakers (Realtek(R) Audio)"; strip USB ids like "(046d:0825)".
  return label.replace(/^(Default|Communications) - /, "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "").trim();
}

export async function refreshDevices(): Promise<DeviceList> {
  if (!navigator.mediaDevices?.enumerateDevices) return list;
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const pick = (kind: MediaDeviceKind, fallback: string) => {
    const seen = new Set<string>();
    const out: DeviceOption[] = [];
    let n = 0;
    for (const d of all) {
      if (d.kind !== kind || !d.deviceId) continue;
      // Chrome lists "default" and "communications" as extra copies of real devices.
      if (d.deviceId === "default" || d.deviceId === "communications") continue;
      if (seen.has(d.deviceId)) continue;
      seen.add(d.deviceId);
      n++;
      out.push({ id: d.deviceId, label: clean(d.label) || `${fallback} ${n}` });
    }
    return out;
  };
  const next: DeviceList = {
    mics: pick("audioinput", "Microphone"),
    cameras: pick("videoinput", "Camera"),
    speakers: pick("audiooutput", "Speaker"),
    labelled: all.some((d) => d.label !== ""),
  };
  const added: { kind: MediaDeviceKind; option: DeviceOption }[] = [];
  if (list !== EMPTY && list.labelled && next.labelled) {
    const before = new Set([...list.mics, ...list.cameras, ...list.speakers].map((d) => d.id));
    for (const [kind, options] of [
      ["audioinput", next.mics],
      ["videoinput", next.cameras],
      ["audiooutput", next.speakers],
    ] as const) {
      for (const option of options) if (!before.has(option.id)) added.push({ kind, option });
    }
  }
  list = next;
  listListeners.forEach((fn) => fn(added));
  return list;
}

function watch() {
  if (watching || !navigator.mediaDevices) return;
  watching = true;
  navigator.mediaDevices.addEventListener?.("devicechange", () => void refreshDevices());
  void refreshDevices();
}

export const devices = {
  get: () => list,
  /** `fn` also learns which devices were just plugged in. */
  subscribe(fn: (added: { kind: MediaDeviceKind; option: DeviceOption }[]) => void) {
    watch();
    listListeners.add(fn);
    return () => void listListeners.delete(fn);
  },
};

/**
 * Asks once for the mic (and camera) so the browser reveals the real device
 * names ("AirPods Pro" instead of "Microphone 2").
 */
export async function unlockDeviceNames(camera: boolean): Promise<void> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: camera });
  s.getTracks().forEach((t) => t.stop());
  await refreshDevices();
}

/** The chosen device if it's still plugged in, otherwise "" (system default). */
export function liveChoice(kind: "mic" | "camera" | "speaker"): string {
  const id = prefs[kind];
  if (!id) return "";
  const options = kind === "mic" ? list.mics : kind === "camera" ? list.cameras : list.speakers;
  // Before the list has loaded, trust the saved choice ("ideal" constraints fall back on their own).
  if (list === EMPTY) return id;
  return options.some((o) => o.id === id) ? id : "";
}

/**
 * Constraint for a chosen device: "exact" when we know it's plugged in (Chrome
 * treats "ideal" as a mere hint and may keep the default), "ideal" otherwise so
 * a stale choice never makes the call fail.
 */
export function deviceConstraint(kind: "mic" | "camera", id: string): ConstrainDOMString | undefined {
  if (!id) return undefined;
  const options = kind === "mic" ? list.mics : list.cameras;
  return options.some((o) => o.id === id) ? { exact: id } : { ideal: id };
}

export function deviceLabel(kind: "mic" | "camera" | "speaker", id: string): string {
  const options = kind === "mic" ? list.mics : kind === "camera" ? list.cameras : list.speakers;
  return options.find((o) => o.id === id)?.label ?? "System default";
}

/** Sends an <audio>/<video> element's sound to the chosen speaker. */
export async function applySpeaker(el: HTMLMediaElement, id: string): Promise<void> {
  if (!canPickSpeaker) return;
  const sink = el as HTMLMediaElement & { sinkId?: string; setSinkId?: (id: string) => Promise<void> };
  if (sink.sinkId === id) return;
  await sink.setSinkId?.(id).catch(() => sink.setSinkId?.("").catch(() => {}));
}

/** A short chime on the chosen speaker, to check you can hear. */
export async function playTestSound(speakerId: string, volume: number): Promise<void> {
  const rate = 24_000;
  const length = Math.round(rate * 0.9);
  const data = new Int16Array(length);
  const notes: [number, number][] = [
    [523.25, 0],
    [659.25, 0.15],
    [783.99, 0.3],
  ];
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    let v = 0;
    for (const [f, start] of notes) {
      if (t < start) continue;
      const age = t - start;
      v += Math.sin(2 * Math.PI * f * age) * Math.exp(-age * 5) * Math.min(1, age * 200);
    }
    data[i] = Math.max(-1, Math.min(1, v * 0.3)) * 0x7fff;
  }
  // Wrap it in a tiny WAV file so a plain <audio> element (which can pick the speaker) plays it.
  const header = new DataView(new ArrayBuffer(44));
  const text = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + data.byteLength, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, data.byteLength, true);
  const url = URL.createObjectURL(new Blob([header, data], { type: "audio/wav" }));
  const el = new Audio(url);
  el.volume = Math.max(0, Math.min(1, volume / 100));
  await applySpeaker(el, speakerId);
  el.onended = () => URL.revokeObjectURL(url);
  await el.play();
}
