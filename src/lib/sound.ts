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
