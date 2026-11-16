import { devicePrefs, liveChoice, type MessageTone, type Ringtone } from "./devices";

let ctx: AudioContext | null = null;
let lastPlayed = 0;

/** The new-message sounds: [frequency, start, length, wave] notes, synthesized (no files to download). */
const MESSAGE_TONES: Record<MessageTone, [number, number, number, OscillatorType][]> = {
  pop: [
    [880, 0, 0.18, "sine"],
    [1320, 0.08, 0.18, "sine"],
  ],
  chime: [
    [1046.5, 0, 0.5, "sine"],
    [1568, 0.12, 0.6, "sine"],
  ],
  drop: [[1400, 0, 0.16, "sine"]],
  tick: [[2000, 0, 0.05, "triangle"]],
};

/**
 * Plays the new-message sound you picked, at your volume, on your chosen speaker.
 * `preview` plays it even inside the burst guard (Settings).
 */
export function playMessageSound(preview?: { tone: MessageTone; volume: number }): void {
  const now = Date.now();
  if (!preview && now - lastPlayed < 600) return; // don't machine-gun on bursts
  lastPlayed = now;
  const prefs = devicePrefs.get();
  const tone = preview?.tone ?? prefs.messageTone;
  const level = (preview?.volume ?? prefs.messageVolume) / 100;
  if (level <= 0) return;
  const c = audio();
  if (!c) return;
  routeToChosenSpeaker(c);
  const t = c.currentTime + 0.02;
  for (const [freq, offset, length, wave] of MESSAGE_TONES[tone]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    // "drop": a quick downward slide, like a water drop.
    if (tone === "drop") osc.frequency.exponentialRampToValueAtTime(500, t + length);
    gain.gain.setValueAtTime(0, t + offset);
    gain.gain.linearRampToValueAtTime(0.13 * level, t + offset + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + length);
    osc.connect(gain).connect(c.destination);
    osc.start(t + offset);
    osc.stop(t + offset + length + 0.02);
  }
}

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** A soft envelope tone. "pluck" decays like a mallet (marimba); otherwise it holds. */
function beep(c: AudioContext, freqs: number[], start: number, length: number, volume: number, shape: OscillatorType = "sine", pluck = false) {
  for (const f of freqs) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = shape;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + (pluck ? 0.005 : 0.03));
    if (pluck) gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    else {
      gain.gain.setValueAtTime(volume, start + length - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + length);
    }
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length);
  }
}

/** One cycle of each ringtone, and how often it repeats. */
const RING_PATTERNS: Record<Exclude<Ringtone, "vibrate">, { every: number; play: (c: AudioContext, t: number, v: number) => void }> = {
  classic: {
    every: 2200,
    play: (c, t, v) => {
      beep(c, [659], t, 0.18, 0.12 * v);
      beep(c, [880], t + 0.22, 0.18, 0.12 * v);
      beep(c, [659], t + 0.6, 0.18, 0.12 * v);
      beep(c, [880], t + 0.82, 0.18, 0.12 * v);
    },
  },
  marimba: {
    every: 2000,
    play: (c, t, v) => {
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => beep(c, [f, f * 4], t + i * 0.13, 0.5, 0.16 * v, "sine", true));
    },
  },
  digital: {
    every: 1800,
    play: (c, t, v) => {
      for (let i = 0; i < 4; i++) beep(c, [1200], t + i * 0.12, 0.07, 0.05 * v, "square");
      for (let i = 0; i < 4; i++) beep(c, [1200], t + 0.6 + i * 0.12, 0.07, 0.05 * v, "square");
    },
  },
  gentle: {
    every: 3200,
    play: (c, t, v) => {
      beep(c, [392], t, 0.9, 0.07 * v, "triangle", true);
      beep(c, [493.88], t + 0.35, 0.9, 0.07 * v, "triangle", true);
      beep(c, [587.33], t + 0.7, 1.4, 0.08 * v, "triangle", true);
    },
  },
};

function routeToChosenSpeaker(c: AudioContext) {
  // Ring on the speaker chosen in Settings → Voice & video (Chrome/Edge can pick one).
  const sink = c as AudioContext & { sinkId?: string; setSinkId?: (id: string) => Promise<void> };
  const speaker = liveChoice("speaker");
  if (sink.setSinkId && (sink.sinkId ?? "") !== speaker) void sink.setSinkId(speaker).catch(() => {});
}

/**
 * Looping call tones, synthesized (no audio files):
 *  - "ring": incoming call, your chosen ringtone (phones also vibrate)
 *  - "ringback": what the caller hears while it rings on the other side
 * Returns a function that stops the tone.
 */
export function startTone(kind: "ring" | "ringback"): () => void {
  const c = audio();
  const prefs = devicePrefs.get();
  const vibrate = kind === "ring" && "vibrate" in navigator;
  if (!c && !vibrate) return () => {};
  if (c) routeToChosenSpeaker(c);
  let stopped = false;
  const pattern = kind === "ring" && prefs.ringtone !== "vibrate" ? RING_PATTERNS[prefs.ringtone] : null;
  const play = () => {
    if (stopped) return;
    if (vibrate) navigator.vibrate([400, 200, 400]);
    if (!c) return;
    const t = c.currentTime + 0.05;
    if (kind === "ring") pattern?.play(c, t, prefs.ringVolume / 80);
    else beep(c, [440, 480], t, 1.2, 0.05);
  };
  play();
  const interval = window.setInterval(play, kind === "ring" ? (pattern?.every ?? 2000) : 3000);
  return () => {
    stopped = true;
    window.clearInterval(interval);
    if (vibrate) navigator.vibrate(0);
  };
}

/** Plays one cycle of a ringtone (Settings preview). */
export function previewRingtone(tone: Ringtone, volume: number): void {
  if (tone === "vibrate") {
    if ("vibrate" in navigator) navigator.vibrate([400, 200, 400]);
    return;
  }
  const c = audio();
  if (!c) return;
  routeToChosenSpeaker(c);
  RING_PATTERNS[tone].play(c, c.currentTime + 0.05, volume / 80);
}
