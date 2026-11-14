import { useEffect, useState, useSyncExternalStore } from "react";
import { devicePrefs, devices, refreshDevices } from "./devices";

export function useDevicePrefs() {
  return useSyncExternalStore(devicePrefs.subscribe, devicePrefs.get);
}

const subscribeList = (fn: () => void) => devices.subscribe(() => fn());

/** The plugged-in mics, cameras and speakers; updates when something is plugged in or out. */
export function useDeviceList() {
  const list = useSyncExternalStore(subscribeList, devices.get);
  useEffect(() => {
    void refreshDevices();
  }, []);
  return list;
}

let levelCtx: AudioContext | null = null;

/**
 * Live loudness of a stream (0–1), measured ~20 times a second.
 * Used for the "speaking" ring and the "you're muted" hint.
 */
export function useAudioLevel(stream: MediaStream | null, enabled = true): number {
  const [level, setLevel] = useState(0);
  const track = stream?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    if (!track || !enabled) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext;
    try {
      levelCtx ??= new AudioContext();
      ctx = levelCtx;
    } catch {
      return;
    }
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-8);
      setLevel(Math.min(1, Math.max(0, (db + 60) / 50)));
    }, 50);
    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [track, enabled]);
  return level;
}

/** True while someone is talking (with a short hold so it doesn't flicker between words). */
export function useSpeaking(stream: MediaStream | null, enabled = true): boolean {
  const level = useAudioLevel(stream, enabled);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (level > 0.38) {
      setSpeaking(true);
      return;
    }
    const t = window.setTimeout(() => setSpeaking(false), 350);
    return () => window.clearTimeout(t);
  }, [level > 0.38]); // eslint-disable-line react-hooks/exhaustive-deps
  return speaking;
}
