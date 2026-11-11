import { LIMITS } from "../../shared/types";

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // WebP is ~30% smaller; older Safari falls back to JPEG.
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("Couldn't process this image.");
  return jpeg;
}

function drawToCanvas(bitmap: ImageBitmap, width: number, height: number, sx = 0, sy = 0, sw?: number, sh?: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw ?? bitmap.width, sh ?? bitmap.height, 0, 0, width, height);
  return canvas;
}

/**
 * Resizes and re-encodes a photo in the browser before upload. A typical 4 MB
 * phone photo becomes ~250 KB, so it uploads fast and stays within free storage.
 * Re-encoding also strips EXIF metadata such as GPS location.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("Couldn't read this image.");
  });

  // Keep small GIFs untouched so they stay animated.
  if (file.type === "image/gif" && file.size <= LIMITS.mediaMaxBytes) {
    const result = { blob: file as Blob, width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }

  let max: number = LIMITS.imageMaxDimension;
  let quality = 0.82;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const blob = await encode(drawToCanvas(bitmap, width, height), quality);
    if (blob.size <= LIMITS.mediaMaxBytes) {
      bitmap.close();
      return { blob, width, height };
    }
    max = Math.round(max * 0.75);
    quality -= 0.08;
  }
  bitmap.close();
  throw new Error("This image is too large.");
}

/** Square, centered 256×256 profile picture. */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("Couldn't read this image.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = drawToCanvas(
    bitmap,
    256,
    256,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
  );
  bitmap.close();
  const blob = await encode(canvas, 0.85);
  if (blob.size > LIMITS.avatarMaxBytes) throw new Error("This image is too large.");
  return blob;
}

// ---------- Voice ----------

export interface Recording {
  blob: Blob;
  duration: number;
  waveform: number[];
}

const WAVEFORM_BARS = 48;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private levels: number[] = [];
  private raf = 0;
  private startedAt = 0;

  static isSupported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  /** Starts recording. `onLevel` receives live 0–1 loudness for the UI. */
  async start(onLevel: (level: number) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Opus in WebM (Chrome/Firefox/Android) or AAC in MP4 (Safari/iOS).
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    this.recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 32_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();

    this.audioCtx = new AudioContext();
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      this.levels.push(level);
      onLevel(level);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  get elapsed(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) throw new Error("Not recording.");
    const duration = this.elapsed;
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await stopped;
    const type = (recorder.mimeType || "audio/webm").split(";")[0];
    const blob = new Blob(this.chunks, { type });
    const waveform = downsample(this.levels, WAVEFORM_BARS);
    this.cleanup();
    return { blob, duration, waveform };
  }

  cancel(): void {
    try {
      this.recorder?.stop();
    } catch {
      // already stopped
    }
    this.cleanup();
  }

  private cleanup(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.stream = null;
    this.recorder = null;
    this.audioCtx = null;
    this.levels = [];
    this.startedAt = 0;
  }
}

function downsample(levels: number[], bars: number): number[] {
  if (levels.length === 0) return Array(bars).fill(0.1);
  const out: number[] = [];
  const size = levels.length / bars;
  for (let i = 0; i < bars; i++) {
    const slice = levels.slice(Math.floor(i * size), Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1));
    out.push(slice.reduce((a, b) => Math.max(a, b), 0));
  }
  const peak = Math.max(...out, 0.01);
  return out.map((v) => Math.max(0.08, Math.round((v / peak) * 100) / 100));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
