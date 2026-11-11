import { GtcrnWorkletNode, loadGtcrn, loadRnnoise, NoiseGateWorkletNode, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import gtcrnWasmUrl from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import gtcrnWorkletUrl from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import gateWorkletUrl from "@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import type { Settings } from "../../shared/types";

export type VoiceSettings = Pick<Settings, "noiseSuppression" | "echoCancellation" | "autoGainControl" | "noiseGate">;

/**
 * Microphone constraints for the browser's own processing.
 * In AI mode the browser's noise filter is turned off so the two don't fight
 * (like Discord, where Krisp replaces "Standard").
 */
export function micConstraints(v: VoiceSettings): MediaTrackConstraints {
  return {
    echoCancellation: v.echoCancellation,
    autoGainControl: v.autoGainControl,
    noiseSuppression: v.noiseSuppression === "standard",
    channelCount: 1,
  };
}

/**
 * Must be called synchronously inside a tap/click (iPhones only allow audio to
 * start there). 48 kHz is what the AI noise suppressor expects.
 */
export function createAudioContext(): AudioContext {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new Ctx({ sampleRate: 48_000, latencyHint: "interactive" });
  } catch {
    return new Ctx();
  }
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;
let gtcrnWasm: Promise<ArrayBuffer> | null = null;

export type AiEngine = "gtcrn" | "rnnoise";

/**
 * Which neural network to run in AI mode. Measured on real speech mixed with fan
 * noise and background voices: GTCRN keeps the voice intact and removes the most
 * noise (SNR 3 dB → 15.5 dB) but needs more CPU; RNNoise is ~1.5x lighter
 * (3 dB → 12.8 dB). Computers and phones with 8+ cores get GTCRN.
 */
export function pickAiEngine(): AiEngine {
  const cores = navigator.hardwareConcurrency ?? 4;
  const desktop = window.matchMedia("(pointer: fine)").matches;
  return desktop || cores >= 8 ? "gtcrn" : "rnnoise";
}
const loadedModules = new WeakMap<AudioContext, Set<string>>();

async function addModule(ctx: AudioContext, url: string) {
  const set = loadedModules.get(ctx) ?? new Set<string>();
  if (!set.has(url)) {
    await ctx.audioWorklet.addModule(url);
    set.add(url);
    loadedModules.set(ctx, set);
  }
}

export interface ProcessedMic {
  /** Processed audio (plus any video tracks from the input), ready to send or record. */
  stream: MediaStream;
  /** Which noise suppression actually ended up running (AI can fall back to standard). */
  mode: VoiceSettings["noiseSuppression"];
  /** Which neural network is running in AI mode. */
  engine?: AiEngine;
  dispose: () => void;
}

/**
 * Runs the microphone through the AI noise suppressor and/or noise gate when
 * enabled. Everything happens on the device, in an AudioWorklet. If the browser
 * can't run it (e.g. Firefox with a 44.1 kHz mic), it quietly falls back to the
 * browser's standard noise suppression instead of failing.
 */
export async function processMic(raw: MediaStream, v: VoiceSettings, ctx: AudioContext): Promise<ProcessedMic> {
  const audio = raw.getAudioTracks()[0];
  const passthrough = (mode: ProcessedMic["mode"]): ProcessedMic => ({ stream: raw, mode, dispose: () => {} });
  if (!audio || (v.noiseSuppression !== "ai" && !v.noiseGate)) return passthrough(v.noiseSuppression);

  const nodes: AudioNode[] = [];
  try {
    if (!ctx.audioWorklet) throw new Error("AudioWorklet not supported");
    const source = ctx.createMediaStreamSource(new MediaStream([audio]));
    nodes.push(source);
    let last: AudioNode = source;

    let engine: AiEngine | undefined;
    if (v.noiseSuppression === "ai") {
      engine = pickAiEngine();
      let ai: AudioWorkletNode;
      if (engine === "gtcrn") {
        gtcrnWasm ??= loadGtcrn({ url: gtcrnWasmUrl });
        const [wasmBinary] = await Promise.all([gtcrnWasm, addModule(ctx, gtcrnWorkletUrl)]);
        ai = new GtcrnWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
      } else {
        rnnoiseWasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
        const [wasmBinary] = await Promise.all([rnnoiseWasm, addModule(ctx, rnnoiseWorkletUrl)]);
        ai = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
      }
      last.connect(ai);
      last = ai;
      nodes.push(ai);
    }
    if (v.noiseGate) {
      await addModule(ctx, gateWorkletUrl);
      // Opens when you speak, closes ~0.2 s after you stop.
      const gate = new NoiseGateWorkletNode(ctx, { openThreshold: -48, closeThreshold: -54, holdMs: 200, maxChannels: 1 });
      last.connect(gate);
      last = gate;
      nodes.push(gate);
    }

    const destination = ctx.createMediaStreamDestination();
    last.connect(destination);
    ctx.resume().catch(() => {});
    const processed = destination.stream.getAudioTracks()[0];
    // Keep the processed track in sync with the real mic (e.g. mute via `enabled`).
    audio.addEventListener("ended", () => processed.stop());

    return {
      stream: new MediaStream([processed, ...raw.getVideoTracks()]),
      mode: v.noiseSuppression,
      engine,
      dispose: () => {
        processed.stop();
        for (const n of nodes) {
          try {
            n.disconnect();
            (n as unknown as { destroy?: () => void }).destroy?.();
          } catch {
            // already gone
          }
        }
      },
    };
  } catch (err) {
    console.warn("Noise suppression unavailable, using the browser's built-in filter", err);
    nodes.forEach((n) => n.disconnect());
    await audio.applyConstraints({ ...micConstraints(v), noiseSuppression: true }).catch(() => {});
    return passthrough("standard");
  }
}
