let ctx: AudioContext | null = null;
let lastPlayed = 0;

/** A soft two-note "pop", synthesized so there's no audio file to download. */
export function playMessageSound(): void {
  const now = Date.now();
  if (now - lastPlayed < 600) return; // don't machine-gun on bursts
  lastPlayed = now;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    for (const [freq, offset] of [
      [880, 0],
      [1320, 0.08],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.08, t + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    }
  } catch {
    // audio not available — ignore
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

function beep(c: AudioContext, freqs: number[], start: number, length: number, volume: number) {
  for (const f of freqs) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.03);
    gain.gain.setValueAtTime(volume, start + length - 0.05);
    gain.gain.linearRampToValueAtTime(0, start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length);
  }
}

/**
 * Looping call tones, synthesized (no audio files):
 *  - "ring": incoming call, a friendly two-note chime
 *  - "ringback": what the caller hears while it rings on the other side
 * Returns a function that stops the tone.
 */
export function startTone(kind: "ring" | "ringback"): () => void {
  const c = audio();
  if (!c) return () => {};
  let stopped = false;
  const play = () => {
    if (stopped) return;
    const t = c.currentTime + 0.05;
    if (kind === "ring") {
      beep(c, [659], t, 0.18, 0.12);
      beep(c, [880], t + 0.22, 0.18, 0.12);
      beep(c, [659], t + 0.6, 0.18, 0.12);
      beep(c, [880], t + 0.82, 0.18, 0.12);
    } else {
      beep(c, [440, 480], t, 1.2, 0.05);
    }
  };
  play();
  const interval = window.setInterval(play, kind === "ring" ? 2200 : 3000);
  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}
