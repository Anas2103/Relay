import { CALL_REACTIONS, type CallEnvelope, type CallInfo, type CallSignal, type IceCandidate, type LobbyEvent } from "../../shared/types";
import { api } from "./api";
import { createAudioContext, micConstraints, processMic, type AiEngine, type ProcessedMic, type VoiceSettings } from "./audio";
import { deviceConstraint, devicePrefs, devices, liveChoice, type DeviceOption } from "./devices";
import { canUseDevices, deviceProblem, type DeviceProblem } from "./media";
import { isMobile, needsAudioRelay } from "./output";
import { startTone } from "./sound";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallQuality = "good" | "fair" | "poor";

export interface CallNotice {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export interface CallReaction {
  id: number;
  emoji: string;
  mine: boolean;
  /** Horizontal position, 0–1, so several don't stack on top of each other. */
  x: number;
}

export interface CallStats {
  /** Round trip in milliseconds. */
  rtt: number | null;
  /** Share of the other person's audio packets lost recently, 0–1. */
  loss: number;
  /** Going through a relay server instead of directly (strict networks). */
  relayed: boolean;
}

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  roomId: string | null;
  peerId: string | null;
  peerName: string;
  /** Started as a video call (vs voice). Either side can still turn a camera on later. */
  video: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  peerMicOn: boolean;
  peerCamOn: boolean;
  /** The other person is showing their screen. */
  peerScreen: boolean;
  /** You're showing your screen. */
  screenSharing: boolean;
  /** The sound of what you're sharing (a tab's music or video) goes to the other person too. */
  screenAudio: boolean;
  /** This call can carry video (false only when talking to an old version of the app on a voice call). */
  canVideo: boolean;
  facing: "user" | "environment";
  /** When the call connected (for the timer). */
  connectedAt: number | null;
  /** Network dropped mid-call; trying to recover. */
  reconnecting: boolean;
  /** Shown briefly on the "call ended" screen. */
  endReason: string | null;
  /** Couldn't start the mic/camera. */
  problem: DeviceProblem | null;
  /** Noise suppression actually running right now (AI can fall back to standard). */
  voiceMode: VoiceSettings["noiseSuppression"] | null;
  voiceEngine: AiEngine | null;
  /** Call shrunk into the chat header so you can keep chatting. */
  minimized: boolean;
  /** What you hear: the remote audio, or a cleaned-up version when "clean incoming" is on. */
  playbackStream: MediaStream | null;
  incomingCleaned: boolean;
  /** What you hear runs through a Web Audio volume knob (iPhone, or boosted above 100%). */
  outputRelayed: boolean;
  /** The browser paused audio processing (iPhone in the background, an interruption): a tap restarts it. */
  audioPaused: boolean;
  /** Your raw mic (unaffected by mute), for "you're muted" hints and the speaking ring. */
  micMonitor: MediaStream | null;
  /** The devices actually in use right now. */
  micId: string;
  cameraId: string;
  quality: CallQuality | null;
  stats: CallStats | null;
  /** A short message at the top of the call ("AirPods connected — Use them"). */
  notice: CallNotice | null;
  /** Floating emoji on screen right now. */
  reactions: CallReaction[];
  /** Push-to-talk is on and you're holding the key. */
  talking: boolean;
}

const IDLE: CallState = {
  phase: "idle",
  callId: null,
  roomId: null,
  peerId: null,
  peerName: "",
  video: false,
  localStream: null,
  remoteStream: null,
  micOn: true,
  camOn: true,
  peerMicOn: true,
  peerCamOn: true,
  peerScreen: false,
  screenSharing: false,
  screenAudio: false,
  canVideo: false,
  facing: "user",
  connectedAt: null,
  reconnecting: false,
  endReason: null,
  problem: null,
  voiceMode: null,
  voiceEngine: null,
  minimized: false,
  playbackStream: null,
  incomingCleaned: false,
  outputRelayed: false,
  audioPaused: false,
  micMonitor: null,
  micId: "",
  cameraId: "",
  quality: null,
  stats: null,
  notice: null,
  reactions: [],
  talking: false,
};

const RING_TIMEOUT_MS = 45_000;
const RECONNECT_GRACE_MS = 12_000;
const NOTICE_MS = 7000;

/**
 * Asks for better Opus voice than the browser default: forward error correction
 * (hides lost packets), up to 128 kbps (the rate actually used follows
 * Settings → Audio quality) and full-band 48 kHz. Only Opus's a=fmtp line
 * changes, so every browser still understands the description.
 */
export function tuneOpus(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const want: [string, string][] = [
    ["useinbandfec", "1"],
    ["maxaveragebitrate", "128000"],
    ["maxplaybackrate", "48000"],
  ];
  const lines = sdp.split("\r\n");
  const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
  if (i === -1) {
    const at = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
    lines.splice(at + 1, 0, `a=fmtp:${pt} ${want.map((kv) => kv.join("=")).join(";")}`);
    return lines.join("\r\n");
  }
  const params = new Map(
    lines[i]
      .slice(`a=fmtp:${pt} `.length)
      .split(";")
      .map((kv) => kv.trim().split("=") as [string, string])
      .filter(([k]) => !!k),
  );
  for (const [k, v] of want) if (!params.has(k)) params.set(k, v);
  lines[i] = `a=fmtp:${pt} ${[...params].map((kv) => kv.join("=")).join(";")}`;
  return lines.join("\r\n");
}

/**
 * Can this browser share the screen? Desktop browsers can; phones can't. (This used
 * to check "pointer: coarse", which also hid the button on touchscreen laptops.)
 */
export const canShareScreen = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !isMobile;

/**
 * One-to-one voice/video calls over WebRTC. Audio and video go directly between
 * the two browsers (peer-to-peer, encrypted by WebRTC's built-in DTLS-SRTP);
 * the server only relays the small setup messages through the Lobby socket.
 *
 * Every call carries a video channel, even voice calls, so either side can turn
 * on a camera or share a screen mid-call without re-negotiating.
 */
class CallManager {
  private state: CallState = IDLE;
  private listeners = new Set<() => void>();
  private send: ((env: CallEnvelope) => boolean) | null = null;
  private pc: RTCPeerConnection | null = null;
  private pendingIce: IceCandidate[] = [];
  private offerSdp: string | null = null;
  private role: "caller" | "callee" | null = null;
  private stopTone: (() => void) | null = null;
  private ringTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private resetTimer: number | undefined;
  private noticeTimer: number | undefined;
  private statsTimer: number | undefined;
  /** Who to log the call to (the caller writes the record into the chat). */
  onRecord: ((roomId: string, info: CallInfo) => void) | null = null;
  /** Called on an incoming call so the app can show a notification if hidden. */
  onIncoming: ((name: string, video: boolean) => void) | null = null;
  /** Noise suppression / echo cancellation / gain settings (kept in sync with the user's settings). */
  voice: VoiceSettings = { noiseSuppression: "ai", echoCancellation: true, autoGainControl: true, noiseGate: false };
  private rawMic: MediaStream | null = null;
  private processedMic: ProcessedMic | null = null;
  private audioCtx: AudioContext | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  /** The shared tab's/screen's own sound, mixed with your mic while you stream. */
  private screenAudioTrack: MediaStreamTrack | null = null;
  private mix: { track: MediaStreamTrack; dispose: () => void } | null = null;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private remote = new MediaStream();
  /** Device changes run one at a time, so quick taps can't leave two mics open. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastPrefs = devicePrefs.get();

  constructor() {
    if (typeof window === "undefined") return;
    devicePrefs.subscribe(() => this.onPrefs());
    devices.subscribe((added) => this.onDevicesAdded(added));
    // iPhones pause audio processing in the background or during a phone call: pick it back up.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.resumeAudio();
    });
  }

  /** Restarts paused audio processing (call it from a tap if the browser insists). */
  async resumeAudio(): Promise<void> {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    await ctx.resume().catch(() => {});
  }

  private watchAudioContext(ctx: AudioContext) {
    const update = () => {
      if (this.audioCtx !== ctx) return;
      // "suspended"/"interrupted": no sound gets through until it runs again.
      const paused = ctx.state !== "running" && ctx.state !== "closed";
      if (paused !== this.state.audioPaused) this.set({ audioPaused: paused });
    };
    ctx.addEventListener("statechange", update);
    // Give the first start a moment before calling it paused.
    window.setTimeout(update, 1500);
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Mic is open (ringing, connecting or talking). */
  private get live() {
    const p = this.state.phase;
    return !!this.rawMic && (p === "outgoing" || p === "connecting" || p === "active");
  }

  // ---- microphone ----

  /**
   * Opens the mic (and camera) and runs the audio through noise suppression.
   * The AudioContext is created synchronously, before any await, so it's allowed
   * to start on iPhones (it must happen inside the tap).
   */
  private async openMedia(camera: boolean): Promise<void> {
    this.audioCtx = createAudioContext();
    this.watchAudioContext(this.audioCtx);
    const raw = navigator.mediaDevices.getUserMedia({
      audio: micConstraints(this.voice),
      video: camera ? this.videoConstraints() : false,
    });
    this.audioCtx.resume().catch(() => {});
    const stream = await raw;
    const cam = stream.getVideoTracks()[0] ?? null;
    if (cam) this.adoptCamera(cam);
    const mic = new MediaStream(stream.getAudioTracks());
    this.adoptMic(mic);
    this.processedMic = await processMic(mic, this.voice, this.audioCtx);
    // Push-to-talk: start muted; holding the key opens the mic.
    if (devicePrefs.get().pushToTalk) {
      this.processedMic.stream.getAudioTracks().forEach((t) => (t.enabled = false));
      this.set({ micOn: false });
    }
    this.set({ voiceMode: this.processedMic.mode, voiceEngine: this.processedMic.engine ?? null });
  }

  private adoptMic(raw: MediaStream) {
    const track = raw.getAudioTracks()[0];
    this.rawMic = raw;
    track?.addEventListener("ended", () => {
      if (this.rawMic === raw) void this.onMicLost();
    });
    this.state.micMonitor?.getTracks().forEach((t) => t.stop());
    this.set({ micMonitor: track ? new MediaStream([track.clone()]) : null, micId: track?.getSettings().deviceId ?? "" });
  }

  private audioTrack() {
    return this.processedMic?.stream.getAudioTracks()[0] ?? null;
  }

  /**
   * What goes out on the audio channel: your mic, or — while you share a tab with
   * sound — your mic mixed with that sound. Muting only silences the mic, so the
   * music keeps playing for the other person.
   */
  private outgoingAudio(): MediaStreamTrack | null {
    const mic = this.audioTrack();
    const ctx = this.audioCtx;
    this.mix?.dispose();
    this.mix = null;
    const tab = this.screenAudioTrack;
    if (!tab || tab.readyState !== "live" || !ctx || !mic) return mic;
    try {
      const dest = ctx.createMediaStreamDestination();
      const micIn = ctx.createMediaStreamSource(new MediaStream([mic]));
      const tabIn = ctx.createMediaStreamSource(new MediaStream([tab]));
      micIn.connect(dest);
      tabIn.connect(dest);
      ctx.resume().catch(() => {});
      const out = dest.stream.getAudioTracks()[0];
      this.mix = {
        track: out,
        dispose: () => {
          out.stop();
          micIn.disconnect();
          tabIn.disconnect();
        },
      };
      return out;
    } catch (err) {
      console.warn("Couldn't mix the shared sound in", err);
      return mic;
    }
  }

  private async sendOutgoingAudio() {
    await this.audioSender?.replaceTrack(this.outgoingAudio()).catch(() => {});
    await this.applyAudioQuality();
  }

  /** Rebuilds the outgoing audio (new mic, new settings) and swaps it in place — no dropped call. */
  private swapAudio(newRaw: MediaStream | null) {
    return this.serial(async () => {
      const ctx = this.audioCtx;
      const raw = newRaw ?? this.rawMic;
      const rawAudio = raw?.getAudioTracks()[0];
      if (!ctx || !raw || !rawAudio) {
        newRaw?.getTracks().forEach((t) => t.stop());
        return;
      }
      const previous = this.processedMic;
      const previousRaw = this.rawMic;
      const processed = await processMic(new MediaStream([rawAudio]), this.voice, ctx);
      if (this.audioCtx !== ctx) {
        // the call ended while we were busy
        processed.dispose();
        newRaw?.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = processed.stream.getAudioTracks()[0];
      track.enabled = this.state.micOn;
      this.processedMic = processed;
      await this.sendOutgoingAudio();
      if (previous && previous.stream.getAudioTracks()[0] !== track) previous.dispose();
      if (newRaw && newRaw !== previousRaw) {
        previousRaw?.getTracks().forEach((t) => t.stop());
        this.adoptMic(newRaw);
      }
      this.composeLocal();
      this.set({ voiceMode: processed.mode, voiceEngine: processed.engine ?? null });
    });
  }

  private async openMicOnly(deviceId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: micConstraints(this.voice, deviceId) });
  }

  /** The mic was unplugged (or the system took it): carry on with the default one. */
  private async onMicLost() {
    if (!this.live) return;
    try {
      const fresh = await this.openMicOnly("");
      await this.swapAudio(fresh);
      const label = fresh.getAudioTracks()[0]?.label;
      this.notify(`Microphone disconnected${label ? ` — now using ${label}` : ""}`);
    } catch {
      this.notify("Microphone disconnected — plug one in to keep talking");
    }
  }

  // ---- camera ----

  private videoConstraints(): MediaTrackConstraints {
    const id = liveChoice("camera");
    return {
      ...(id ? { deviceId: deviceConstraint("camera", id) } : { facingMode: this.state.facing }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    };
  }

  private adoptCamera(track: MediaStreamTrack) {
    this.camTrack = track;
    track.addEventListener("ended", () => {
      if (this.camTrack === track) void this.onCameraLost();
    });
    const s = track.getSettings();
    this.set({ cameraId: s.deviceId ?? "", facing: s.facingMode === "environment" ? "environment" : "user" });
  }

  private async openCamera(): Promise<MediaStreamTrack> {
    const s = await navigator.mediaDevices.getUserMedia({ video: this.videoConstraints() });
    return s.getVideoTracks()[0];
  }

  /** Puts a new camera track in place of the old one. */
  private async useCameraTrack(track: MediaStreamTrack) {
    const old = this.camTrack;
    this.adoptCamera(track);
    if (!this.screenTrack) await this.videoSender?.replaceTrack(track).catch(() => {});
    old?.stop();
    this.composeLocal();
    void this.applyVideoQuality();
  }

  /**
   * Caps the video you send: "saver" (~250 kbps, half resolution) for mobile data,
   * "hd" (~2.5 Mbps) for the sharpest picture, "auto" lets the browser decide.
   */
  private async applyVideoQuality() {
    const sender = this.videoSender;
    if (!sender) return;
    const quality = devicePrefs.get().videoQuality;
    const params = sender.getParameters();
    if (!params.encodings?.length) return; // not negotiated yet; applied again once connected
    const screen = !!this.screenTrack;
    // A shared video should stay smooth; shared text should stay sharp.
    params.degradationPreference = screen && devicePrefs.get().shareMode === "detail" ? "maintain-resolution" : screen ? "maintain-framerate" : "balanced";
    for (const e of params.encodings) {
      if (quality === "saver") {
        e.maxBitrate = screen ? 500_000 : 250_000;
        e.scaleResolutionDownBy = screen ? 1 : 2;
      } else if (quality === "hd") {
        e.maxBitrate = 2_500_000;
        e.scaleResolutionDownBy = 1;
      } else {
        delete e.maxBitrate;
        e.scaleResolutionDownBy = 1;
      }
    }
    await sender.setParameters(params).catch(() => {});
  }

  /**
   * Voice quality you send (Opus). "auto" is clear voice (up to 48 kbps, and the browser
   * still lowers it on a bad network), "high" allows up to 128 kbps for the clearest voice and music,
   * "saver" caps it at 16 kbps for very weak connections. Voice always gets
   * priority over video when the network is busy.
   */
  private async applyAudioQuality() {
    const sender = this.audioSender;
    if (!sender) return;
    const quality = devicePrefs.get().audioQuality;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    // Streaming a tab's music or video: give it room, unless you asked to save data.
    const music = !!this.mix;
    for (const e of params.encodings) {
      // "auto": 48 kbps is clear wideband voice and still tiny next to video.
      e.maxBitrate = quality === "saver" ? (music ? 32_000 : 16_000) : quality === "high" || music ? 128_000 : 48_000;
      e.priority = "high";
      (e as RTCRtpEncodingParameters & { networkPriority?: RTCPriorityType }).networkPriority = "high";
    }
    await sender.setParameters(params).catch(() => {});
  }

  // ---- reactions ----

  private reactionSeq = 0;
  private lastReactionAt = 0;

  private showReaction(emoji: string, mine: boolean) {
    const id = ++this.reactionSeq;
    const r: CallReaction = { id, emoji, mine, x: 0.15 + Math.random() * 0.7 };
    this.set({ reactions: [...this.state.reactions.slice(-11), r] });
    window.setTimeout(() => this.set({ reactions: this.state.reactions.filter((x) => x.id !== id) }), 3200);
  }

  /** Sends a floating emoji to the other person (and shows it to you). */
  sendReaction(emoji: string) {
    if (this.state.phase !== "active" || !(CALL_REACTIONS as readonly string[]).includes(emoji)) return;
    const now = Date.now();
    if (now - this.lastReactionAt < 250) return; // no spamming
    this.lastReactionAt = now;
    this.signal({ type: "reaction", emoji });
    this.showReaction(emoji, true);
  }

  /** Push-to-talk: hold to speak. */
  setTalking(held: boolean) {
    if (!devicePrefs.get().pushToTalk || !this.live) return;
    if (held === this.state.talking) return;
    this.set({ talking: held });
    this.setMicOn(held);
  }

  private camLosses: number[] = [];

  private async onCameraLost() {
    if (!this.live) return;
    this.camTrack = null;
    const lostId = this.state.cameraId;
    // Don't loop forever on a camera that keeps dying.
    const now = Date.now();
    this.camLosses = this.camLosses.filter((t) => now - t < 15_000).concat(now);
    const giveUp = this.camLosses.length > 3;
    // Cameras sometimes hiccup (driver reset, another app grabbed it): try the same one again first.
    await new Promise((r) => window.setTimeout(r, 400));
    if (!this.live || !this.state.camOn) return;
    try {
      if (giveUp) throw new Error("camera keeps failing");
      let fresh: MediaStreamTrack;
      try {
        fresh = await this.openCamera();
      } catch {
        fresh = (await navigator.mediaDevices.getUserMedia({ video: { ...this.videoConstraints(), deviceId: undefined } })).getVideoTracks()[0];
      }
      if (fresh.readyState !== "live") throw new Error("camera ended");
      await this.useCameraTrack(fresh);
      if (fresh.getSettings().deviceId !== lostId) this.notify("Camera disconnected — switched to another camera");
    } catch {
      if (!this.screenTrack) await this.videoSender?.replaceTrack(null).catch(() => {});
      this.set({ camOn: false });
      this.composeLocal();
      this.sendMedia();
      this.notify("Camera disconnected");
    }
  }

  /** What you see of yourself: your audio plus your camera (or the screen you're sharing). */
  private composeLocal() {
    const tracks = [this.audioTrack(), this.screenTrack ?? (this.state.camOn ? this.camTrack : null)].filter(
      (t): t is MediaStreamTrack => !!t,
    );
    this.set({ localStream: tracks.length ? new MediaStream(tracks) : null });
  }

  private sendMedia() {
    this.signal({
      type: "media",
      audio: this.state.micOn,
      video: this.state.camOn || this.state.screenSharing,
      screen: this.state.screenSharing,
    });
  }

  // ---- settings changed (here or in Settings) while a call is on ----

  private onPrefs() {
    const p = devicePrefs.get();
    const before = this.lastPrefs;
    this.lastPrefs = p;
    if (!this.live) return;
    if (p.mic !== before.mic) {
      void this.openMicOnly(liveChoice("mic"))
        .then((fresh) => this.swapAudio(fresh))
        .catch(() => this.notify("Couldn't use that microphone"));
    }
    if (p.camera !== before.camera && this.state.camOn && this.camTrack) {
      void this.serial(async () => {
        // Some cameras can't be open twice, so let go of the old one first.
        this.camTrack?.stop();
        try {
          await this.useCameraTrack(await this.openCamera());
        } catch {
          this.notify("Couldn't use that camera");
          this.set({ camOn: false });
          if (!this.screenTrack) await this.videoSender?.replaceTrack(null).catch(() => {});
          this.composeLocal();
          this.sendMedia();
        }
      });
    }
    if (p.pushToTalk !== before.pushToTalk) this.setMicOn(!p.pushToTalk);
    if (p.videoQuality !== before.videoQuality) void this.applyVideoQuality();
    if (p.audioQuality !== before.audioQuality) void this.applyAudioQuality();
    if (p.outputVolume !== before.outputVolume) this.onOutputVolume(p.outputVolume);
    if (p.voiceIsolation !== before.voiceIsolation && p.mic === before.mic) {
      void this.openMicOnly(liveChoice("mic"))
        .then((fresh) => this.swapAudio(fresh))
        .catch(() => this.notify("Couldn't change voice isolation"));
    }
    if (p.aiEngine !== before.aiEngine && this.voice.noiseSuppression === "ai") void this.swapAudio(null);
    if (p.shareMode !== before.shareMode && this.screenTrack) {
      this.screenTrack.contentHint = p.shareMode === "motion" ? "motion" : "detail";
      void this.applyVideoQuality();
    }
    if (p.micVolume !== before.micVolume) {
      if (this.processedMic?.setVolume) this.processedMic.setVolume(p.micVolume);
      else void this.swapAudio(null);
    }
  }

  /** A headset or camera was plugged in during the call: offer to switch to it. */
  private onDevicesAdded(added: { kind: MediaDeviceKind; option: DeviceOption }[]) {
    if (!this.live || added.length === 0) return;
    const mic = added.find((a) => a.kind === "audioinput");
    const speaker = added.find((a) => a.kind === "audiooutput");
    const cam = added.find((a) => a.kind === "videoinput");
    if (mic) {
      this.notify(`${mic.option.label} connected`, {
        label: "Use it",
        run: () => devicePrefs.set({ mic: mic.option.id, ...(speaker ? { speaker: speaker.option.id } : {}) }),
      });
    } else if (speaker) {
      this.notify(`${speaker.option.label} connected`, { label: "Use it", run: () => devicePrefs.set({ speaker: speaker.option.id }) });
    } else if (cam && this.state.camOn) {
      this.notify(`${cam.option.label} connected`, { label: "Use it", run: () => devicePrefs.set({ camera: cam.option.id }) });
    }
  }

  private noticeSeq = 0;
  notify(text: string, action?: CallNotice["action"]) {
    window.clearTimeout(this.noticeTimer);
    const id = ++this.noticeSeq;
    this.set({ notice: { id, text, action } });
    this.noticeTimer = window.setTimeout(() => {
      if (this.state.notice?.id === id) this.set({ notice: null });
    }, NOTICE_MS);
  }

  dismissNotice() {
    window.clearTimeout(this.noticeTimer);
    this.set({ notice: null });
  }

  // ---- what you hear ----

  /** Whether to also run AI noise suppression on the other person's voice. */
  private cleanIncoming = false;
  private incomingProcessed: ProcessedMic | null = null;
  private feeder: HTMLAudioElement | null = null;
  /** Bumped on every setupPlayback call, so a slow, outdated run never wins (ontrack fires once per track). */
  private playbackRun = 0;

  /**
   * Decides what you hear. With "clean incoming" on, the other person's audio runs
   * through the AI noise suppressor on your device before it's played.
   */
  private async setupPlayback() {
    const run = ++this.playbackRun;
    const remote = this.state.remoteStream;
    this.incomingProcessed?.dispose();
    this.incomingProcessed = null;
    if (!remote) {
      this.set({ playbackStream: null, incomingCleaned: false });
      return;
    }
    const audio = remote.getAudioTracks();
    if (!this.cleanIncoming || !this.audioCtx || audio.length === 0) {
      this.set({ playbackStream: this.withOutputStage(remote, remote), incomingCleaned: false });
      return;
    }
    this.feed(remote);
    const processed = await processMic(
      new MediaStream(audio),
      { noiseSuppression: "ai", echoCancellation: false, autoGainControl: false, noiseGate: false },
      this.audioCtx,
      100,
    );
    if (run !== this.playbackRun) {
      processed.dispose(); // a newer run took over
      return;
    }
    if (processed.mode !== "ai" || this.state.remoteStream !== remote) {
      processed.dispose();
      const now = this.state.remoteStream;
      this.set({ playbackStream: now ? this.withOutputStage(now, now) : null, incomingCleaned: false });
      return;
    }
    this.incomingProcessed = processed;
    const cleaned = new MediaStream([...processed.stream.getAudioTracks(), ...remote.getVideoTracks()]);
    this.set({ playbackStream: this.withOutputStage(cleaned, remote), incomingCleaned: true });
  }

  /** Chrome only feeds a remote WebRTC stream into Web Audio while it's also attached to a media element. */
  private feed(remote: MediaStream) {
    this.feeder ??= new Audio();
    this.feeder.muted = true;
    if (this.feeder.srcObject !== remote) this.feeder.srcObject = remote;
    this.feeder.play().catch(() => {});
  }

  private outputStage: { gain: GainNode; dispose: () => void } | null = null;

  /**
   * The volume knob for what you hear. Usually the <audio> element's own volume
   * does it; but on iPhone/iPad that volume is fixed, boosting above 100% needs
   * Web Audio, and Safari only honours a chosen speaker for WebRTC audio after it
   * has passed through Web Audio. In those cases the sound goes
   * remote → gain → a fresh stream → the same <audio> element (so the speaker
   * choice still applies there).
   */
  private withOutputStage(stream: MediaStream, remote: MediaStream): MediaStream {
    this.outputStage?.dispose();
    this.outputStage = null;
    const ctx = this.audioCtx;
    const volume = devicePrefs.get().outputVolume;
    const audio = stream.getAudioTracks();
    if (!ctx || audio.length === 0 || !needsAudioRelay(volume)) {
      if (this.state.outputRelayed) this.set({ outputRelayed: false });
      return stream;
    }
    try {
      if (stream === remote) this.feed(remote);
      const source = ctx.createMediaStreamSource(new MediaStream(audio));
      const gain = ctx.createGain();
      gain.gain.value = volume / 100;
      // A gentle limiter so a boosted voice never clips into distortion.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      const dest = ctx.createMediaStreamDestination();
      source.connect(gain).connect(limiter).connect(dest);
      ctx.resume().catch(() => {});
      const out = dest.stream.getAudioTracks()[0];
      this.outputStage = {
        gain,
        dispose: () => {
          out.stop();
          for (const n of [source, gain, limiter]) n.disconnect();
        },
      };
      this.set({ outputRelayed: true });
      // Keep the video track in the stream: Safari ignores the speaker choice on single-track streams.
      return new MediaStream([out, ...remote.getVideoTracks()]);
    } catch (err) {
      console.warn("Volume control unavailable, playing directly", err);
      this.set({ outputRelayed: false });
      return stream;
    }
  }

  private onOutputVolume(volume: number) {
    if (this.outputStage && needsAudioRelay(volume)) {
      const ctx = this.audioCtx;
      if (ctx) this.outputStage.gain.gain.setTargetAtTime(volume / 100, ctx.currentTime, 0.03);
      return;
    }
    // Crossed 100% (or the stage isn't there yet): rebuild what you hear.
    if (!!this.outputStage !== needsAudioRelay(volume)) void this.setupPlayback();
  }

  private releaseMedia() {
    this.playbackRun++;
    this.outputStage?.dispose();
    this.outputStage = null;
    this.incomingProcessed?.dispose();
    this.incomingProcessed = null;
    if (this.feeder) this.feeder.srcObject = null;
    this.processedMic?.dispose();
    this.processedMic = null;
    this.rawMic?.getTracks().forEach((t) => t.stop());
    this.rawMic = null;
    this.camTrack?.stop();
    this.camTrack = null;
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.mix?.dispose();
    this.mix = null;
    this.screenAudioTrack?.stop();
    this.screenAudioTrack = null;
    this.state.micMonitor?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  // ---- store plumbing (useSyncExternalStore) ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  setTransport(send: ((env: CallEnvelope) => boolean) | null) {
    this.send = send;
  }

  private signal(signal: CallSignal): boolean {
    const { peerId, roomId, callId } = this.state;
    if (!this.send || !peerId || !roomId || !callId) return false;
    return this.send({ type: "call", to: peerId, roomId, callId, signal });
  }

  // ---- outgoing ----

  /** Must be called from a click so the browser shows its mic/camera prompt. */
  async start(roomId: string, peer: { id: string; name: string }, video: boolean) {
    if (this.state.phase !== "idle" && this.state.phase !== "ended") return;
    this.reset();
    const problem = canUseDevices();
    this.role = "caller";
    this.set({
      ...IDLE,
      phase: "outgoing",
      callId: crypto.randomUUID(),
      roomId,
      peerId: peer.id,
      peerName: peer.name,
      video,
      camOn: video,
      peerCamOn: video,
      problem,
    });
    if (problem) return this.finish("Can't use the microphone here", null);

    try {
      await this.openMedia(video);
    } catch (err) {
      this.set({ problem: deviceProblem(err) });
      return this.finish(video ? "Couldn't start the camera" : "Couldn't start the microphone", null);
    }
    // The user may have hung up while the permission prompt was open.
    if (this.getState().phase !== "outgoing") return this.releaseMedia();
    this.composeLocal();

    try {
      const pc = await this.createPeer();
      const audio = this.audioTrack()!;
      this.audioSender = pc.addTrack(audio, this.state.localStream!);
      // Always offer video, so a voice call can turn into a video call later.
      // (Same stream id as the audio, so older app versions keep both in one stream.)
      this.videoSender = pc.addTransceiver(this.camTrack ?? "video", { direction: "sendrecv", streams: [this.state.localStream!] }).sender;
      this.set({ canVideo: true });
      const raw = await pc.createOffer();
      const offer = { type: raw.type, sdp: tuneOpus(raw.sdp ?? "") };
      await pc.setLocalDescription(offer);
      if (!this.signal({ type: "invite", sdp: offer.sdp ?? "", video })) {
        return this.finish("You're offline", "failed");
      }
    } catch {
      return this.finish("Couldn't start the call", "failed");
    }
    this.stopTone = startTone("ringback");
    this.ringTimer = window.setTimeout(() => {
      this.signal({ type: "cancel" });
      this.finish("No answer", "missed");
    }, RING_TIMEOUT_MS);
  }

  // ---- incoming ----

  handle(e: Extract<LobbyEvent, { type: "call" }>) {
    const { signal } = e;
    const current = this.state;

    if (signal.type === "invite") {
      const busy = current.phase !== "idle" && current.phase !== "ended";
      if (busy) {
        this.send?.({ type: "call", to: e.from, roomId: e.roomId, callId: e.callId, signal: { type: "busy" } });
        return;
      }
      this.reset();
      this.role = "callee";
      this.offerSdp = signal.sdp;
      this.set({
        ...IDLE,
        phase: "incoming",
        callId: e.callId,
        roomId: e.roomId,
        peerId: e.from,
        peerName: e.fromName,
        video: signal.video,
        camOn: signal.video && !devicePrefs.get().joinCameraOff,
        peerCamOn: signal.video,
      });
      this.stopTone = startTone("ring");
      this.onIncoming?.(e.fromName, signal.video);
      this.ringTimer = window.setTimeout(() => this.finish("Missed call", null), RING_TIMEOUT_MS + 5000);
      return;
    }

    if (e.callId !== current.callId) return;
    switch (signal.type) {
      case "accept":
        void this.onAccepted(signal.sdp);
        break;
      case "ice":
        if (this.pc?.remoteDescription) this.pc.addIceCandidate(signal.candidate).catch(() => {});
        else this.pendingIce.push(signal.candidate);
        break;
      case "media":
        this.set({ peerMicOn: signal.audio, peerCamOn: signal.video && !signal.screen, peerScreen: !!signal.screen });
        break;
      case "reaction":
        if (current.phase === "active" && (CALL_REACTIONS as readonly string[]).includes(signal.emoji)) this.showReaction(signal.emoji, false);
        break;
      case "decline":
        this.finish("Call declined", "declined");
        break;
      case "busy":
        this.finish("On another call", "busy");
        break;
      case "unavailable":
        this.finish(`${current.peerName || "They"} isn't online`, "missed");
        break;
      case "cancel":
        this.finish("Missed call", null);
        break;
      case "end":
        this.finish("Call ended", this.role === "caller" ? "ended" : null);
        break;
      case "handled":
        if (current.phase === "incoming") this.finish(null, null); // answered on another device
        break;
    }
  }

  private async onAccepted(sdp: string) {
    if (this.role !== "caller" || !this.pc) return;
    window.clearTimeout(this.ringTimer);
    this.stopTone?.();
    this.set({ phase: "connecting" });
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
      await this.flushIce();
    } catch {
      this.finish("Couldn't connect", "failed");
    }
  }

  /**
   * Must be called from a click (mic/camera prompt).
   * `camera: false` answers a video call with your camera off.
   */
  async accept(opts: { camera?: boolean } = {}) {
    if (this.state.phase !== "incoming" || !this.offerSdp) return;
    window.clearTimeout(this.ringTimer);
    this.stopTone?.();
    const problem = canUseDevices();
    if (problem) {
      this.set({ problem });
      this.signal({ type: "decline" });
      return this.finish("Can't use the microphone here", null);
    }
    const camera = this.state.video && (opts.camera ?? this.state.camOn);
    this.set({ phase: "connecting", camOn: camera });

    try {
      await this.openMedia(camera);
    } catch (err) {
      this.set({ problem: deviceProblem(err) });
      this.signal({ type: "decline" });
      return this.finish(camera ? "Couldn't start the camera" : "Couldn't start the microphone", null);
    }
    // Hung up (or the caller cancelled) while the permission prompt was open.
    if (this.getState().phase !== ("connecting" as CallPhase)) return this.releaseMedia();
    this.composeLocal();

    try {
      const pc = await this.createPeer();
      this.audioSender = pc.addTrack(this.audioTrack()!, this.state.localStream!);
      await pc.setRemoteDescription({ type: "offer", sdp: this.offerSdp });
      // Answer the video channel as two-way, even with the camera off, so it can be turned on later.
      const videoTx = pc.getTransceivers().find((t) => t.receiver.track.kind === "video" && t.mid !== null);
      if (videoTx) {
        videoTx.direction = "sendrecv";
        this.videoSender = videoTx.sender;
        (videoTx.sender as RTCRtpSender & { setStreams?: (...s: MediaStream[]) => void }).setStreams?.(this.state.localStream!);
        if (this.camTrack) await videoTx.sender.replaceTrack(this.camTrack);
      } else {
        // Very old caller with a voice-only call: no video channel to use.
        this.camTrack?.stop();
        this.camTrack = null;
        this.set({ camOn: false });
      }
      this.set({ canVideo: !!videoTx });
      await this.flushIce();
      const raw = await pc.createAnswer();
      const answer = { type: raw.type, sdp: tuneOpus(raw.sdp ?? "") };
      await pc.setLocalDescription(answer);
      this.signal({ type: "accept", sdp: answer.sdp ?? "" });
      this.sendMedia();
    } catch {
      this.signal({ type: "end" });
      this.finish("Couldn't connect", null);
    }
  }

  decline() {
    if (this.state.phase !== "incoming") return;
    this.signal({ type: "decline" });
    this.finish(null, null);
  }

  /** Hang up / cancel, whatever the current phase. */
  hangUp() {
    const { phase } = this.state;
    if (phase === "outgoing") {
      this.signal({ type: "cancel" });
      this.finish("Call cancelled", "missed");
    } else if (phase === "incoming") {
      this.decline();
    } else if (phase === "connecting" || phase === "active") {
      this.signal({ type: "end" });
      this.finish("Call ended", this.role === "caller" ? (phase === "active" ? "ended" : "failed") : null);
    }
  }

  // ---- in-call controls ----

  /** Shrinks the call into the chat header (or brings it back to full screen). */
  setMinimized(minimized: boolean) {
    if (this.state.phase !== "idle") this.set({ minimized });
  }

  /**
   * Changes noise suppression / echo / gain / gate in the middle of a call.
   * Rebuilds the audio processing and swaps the outgoing track in place.
   */
  async setVoice(next: VoiceSettings & { cleanIncoming?: boolean }) {
    if (next.cleanIncoming !== undefined && next.cleanIncoming !== this.cleanIncoming) {
      this.cleanIncoming = next.cleanIncoming;
      void this.setupPlayback();
    }
    const pick = (v: VoiceSettings): VoiceSettings => ({
      noiseSuppression: v.noiseSuppression,
      echoCancellation: v.echoCancellation,
      autoGainControl: v.autoGainControl,
      noiseGate: v.noiseGate,
    });
    const changed = JSON.stringify(pick(next)) !== JSON.stringify(pick(this.voice));
    this.voice = pick(next);
    const rawAudio = this.rawMic?.getAudioTracks()[0];
    if (!changed || !rawAudio || !this.audioCtx) return;
    await rawAudio.applyConstraints(micConstraints(this.voice, this.state.micId)).catch(() => {});
    await this.swapAudio(null);
  }

  setMicOn(on: boolean) {
    const track = this.audioTrack();
    if (!track) return;
    track.enabled = on;
    this.set({ micOn: on });
    this.sendMedia();
  }

  toggleMic() {
    this.setMicOn(!this.state.micOn);
  }

  /**
   * Camera on/off. Off really closes the camera (the light goes out); on opens
   * it again — this also works in a voice call, turning it into a video call.
   */
  toggleCam() {
    if (!this.state.canVideo || !this.state.localStream) return;
    return this.serial(async () => {
      if (this.state.camOn) {
        if (!this.screenTrack) await this.videoSender?.replaceTrack(null).catch(() => {});
        this.camTrack?.stop();
        this.camTrack = null;
        this.set({ camOn: false });
      } else {
        try {
          const track = await this.openCamera();
          if (!this.live) return track.stop();
          this.set({ camOn: true });
          await this.useCameraTrack(track);
        } catch (err) {
          const p = deviceProblem(err);
          this.notify(p === "blocked" ? "Camera access is blocked — allow it in your browser's site settings" : "Couldn't start the camera");
          return;
        }
      }
      this.composeLocal();
      this.sendMedia();
    });
  }

  /** Next camera (front ↔ back on phones, or the next webcam on a computer). */
  switchCamera() {
    if (!this.camTrack) return;
    const cams = devices.get().cameras;
    if (cams.length >= 2) {
      const i = cams.findIndex((c) => c.id === this.state.cameraId);
      devicePrefs.set({ camera: cams[(i + 1) % cams.length].id }); // applied by onPrefs
      return;
    }
    // Device list not available (yet): flip by facing.
    return this.serial(async () => {
      const facing = this.state.facing === "user" ? "environment" : "user";
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing } } });
        await this.useCameraTrack(fresh.getVideoTracks()[0]);
      } catch {
        // only one camera — ignore
      }
    });
  }

  /**
   * Streams your screen, a window or a browser tab instead of your camera — with
   * its sound (music, a video) mixed into what the other person hears. Desktop only.
   */
  async toggleScreenShare() {
    if (this.screenTrack) return this.serial(() => this.stopScreenShare());
    if (!canShareScreen || !this.videoSender) return;
    if (!this.state.canVideo) return this.notify("Their app is out of date — they need to reload Relay to see your screen");
    const prefs = devicePrefs.get();
    const motion = prefs.shareMode === "motion";
    let s: MediaStream;
    try {
      // Called straight from the tap (no await before it), or the browser refuses.
      s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: motion ? 30 : 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        // Raw sound: the voice filters would wreck music.
        audio: prefs.shareAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
        // Chrome/Edge: offer "share system audio" too, and don't offer Relay's own tab (it would echo forever).
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== "NotAllowedError" && name !== "AbortError") this.notify("Couldn't share your screen in this browser");
      return; // picker closed
    }
    const track = s.getVideoTracks()[0];
    const sound = s.getAudioTracks()[0] ?? null;
    return this.serial(async () => {
      if (!this.live || !track) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      track.contentHint = motion ? "motion" : "detail";
      track.addEventListener("ended", () => {
        if (this.screenTrack === track) void this.serial(() => this.stopScreenShare()); // "Stop sharing" in the browser bar
      });
      this.screenTrack = track;
      await this.videoSender?.replaceTrack(track).catch(() => {});
      if (sound) {
        sound.contentHint = "music";
        this.screenAudioTrack = sound;
        await this.sendOutgoingAudio();
      }
      this.set({ screenSharing: true, screenAudio: !!sound && !!this.mix });
      this.composeLocal();
      this.sendMedia();
      void this.applyVideoQuality();
      if (prefs.shareAudio && !sound) {
        this.notify("Sharing without sound — to stream music or a video, share a browser tab and turn on “Share tab audio”");
      }
    });
  }

  private async stopScreenShare() {
    const track = this.screenTrack;
    if (!track) return;
    this.screenTrack = null;
    track.stop();
    const sound = this.screenAudioTrack;
    this.screenAudioTrack = null;
    sound?.stop();
    if (sound) await this.sendOutgoingAudio();
    await this.videoSender?.replaceTrack(this.state.camOn ? this.camTrack : null).catch(() => {});
    this.set({ screenSharing: false, screenAudio: false });
    this.composeLocal();
    this.sendMedia();
    void this.applyVideoQuality();
  }

  // ---- internals ----

  private iceCache: { servers: RTCIceServer[]; at: number } | null = null;

  private async createPeer(): Promise<RTCPeerConnection> {
    if (!this.iceCache || Date.now() - this.iceCache.at > 60 * 60 * 1000) {
      const { iceServers } = await api.iceServers().catch(() => ({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] }));
      this.iceCache = { servers: iceServers, at: Date.now() };
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceCache.servers });
    this.pc = pc;
    this.remote = new MediaStream();
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: "ice", candidate: e.candidate.toJSON() as IceCandidate });
    };
    pc.ontrack = (e) => {
      // Collect every incoming track into one stream (the video can arrive without a stream id).
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      this.set({ remoteStream: new MediaStream(this.remote.getTracks()) });
      void this.setupPlayback();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        window.clearTimeout(this.reconnectTimer);
        const first = this.state.connectedAt === null;
        this.set({
          phase: "active",
          reconnecting: false,
          connectedAt: this.state.connectedAt ?? Date.now(),
        });
        if (first) {
          this.sendMedia();
          this.startStats(pc);
          void this.applyVideoQuality();
          void this.applyAudioQuality();
        }
      } else if (s === "disconnected") {
        this.set({ reconnecting: true });
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          if (pc.connectionState !== "connected") {
            this.signal({ type: "end" });
            this.finish("Connection lost", this.role === "caller" ? "ended" : null);
          }
        }, RECONNECT_GRACE_MS);
      } else if (s === "failed") {
        const connected = this.state.connectedAt !== null;
        this.signal({ type: "end" });
        this.finish(
          connected ? "Connection lost" : "Couldn't connect — the network may be blocking calls",
          this.role === "caller" ? (connected ? "ended" : "failed") : null,
        );
      }
    };
    return pc;
  }

  /** Measures the connection every 2 s for the signal-bars indicator. */
  private startStats(pc: RTCPeerConnection) {
    window.clearInterval(this.statsTimer);
    let prevLost = 0;
    let prevReceived = 0;
    let poorFor = 0;
    let suggested = false;
    this.statsTimer = window.setInterval(async () => {
      if (this.pc !== pc) return window.clearInterval(this.statsTimer);
      const report = await pc.getStats().catch(() => null);
      if (!report) return;
      let rtt: number | null = null;
      let localCandidate: string | undefined;
      let lost = 0;
      let received = 0;
      report.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
          if (typeof r.currentRoundTripTime === "number") rtt = r.currentRoundTripTime * 1000;
          localCandidate = r.localCandidateId;
        }
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          lost += r.packetsLost ?? 0;
          received += r.packetsReceived ?? 0;
        }
      });
      const dLost = Math.max(0, lost - prevLost);
      const dReceived = Math.max(0, received - prevReceived);
      prevLost = lost;
      prevReceived = received;
      const loss = dLost + dReceived > 0 ? dLost / (dLost + dReceived) : 0;
      const relayed = localCandidate ? report.get(localCandidate)?.candidateType === "relay" : false;
      const r = rtt as number | null;
      const quality: CallQuality = (r ?? 0) > 400 || loss > 0.08 ? "poor" : (r ?? 0) > 200 || loss > 0.02 ? "fair" : "good";
      // Bad for ~6 s with your camera on: offer to save the call by dropping video.
      poorFor = quality === "poor" ? poorFor + 1 : 0;
      if (poorFor >= 3 && !suggested && this.state.camOn && !this.state.notice) {
        suggested = true;
        this.notify("Weak connection — turning off video can keep the call going", {
          label: "Turn off video",
          run: () => this.state.camOn && void this.toggleCam(),
        });
      }
      this.set({ quality, stats: { rtt: r === null ? null : Math.round(r), loss, relayed } });
    }, 2000);
  }

  private async flushIce() {
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const c of pending) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  /**
   * Tears the call down. `record` = what the caller writes into the chat
   * (null = nothing, e.g. on the callee's side, to avoid duplicates).
   */
  private finish(reason: string | null, record: CallInfo["status"] | null) {
    const { roomId, video, connectedAt, phase } = this.state;
    if (phase === "idle" || phase === "ended") return;
    if (record && roomId && this.role === "caller") {
      this.onRecord?.(roomId, {
        video,
        status: record,
        duration: record === "ended" && connectedAt ? (Date.now() - connectedAt) / 1000 : undefined,
      });
    }
    this.cleanupMedia();
    if (!reason) {
      this.set({ ...IDLE });
      return;
    }
    this.set({
      phase: "ended",
      endReason: reason,
      localStream: null,
      remoteStream: null,
      playbackStream: null,
      micMonitor: null,
      incomingCleaned: false,
      reconnecting: false,
      screenSharing: false,
      screenAudio: false,
      notice: null,
      quality: null,
      stats: null,
      reactions: [],
      talking: false,
    });
    this.resetTimer = window.setTimeout(() => this.set({ ...IDLE }), this.state.problem ? 6000 : 1800);
  }

  private cleanupMedia() {
    window.clearTimeout(this.ringTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.noticeTimer);
    window.clearInterval(this.statsTimer);
    this.stopTone?.();
    this.stopTone = null;
    this.state.localStream?.getTracks().forEach((t) => t.stop());
    this.releaseMedia();
    try {
      this.pc?.close();
    } catch {
      // already closed
    }
    this.pc = null;
    this.audioSender = null;
    this.videoSender = null;
    this.pendingIce = [];
    this.offerSdp = null;
  }

  /** Dismiss the "call ended" screen early. */
  dismiss() {
    if (this.state.phase === "ended") this.set({ ...IDLE });
  }

  private reset() {
    window.clearTimeout(this.resetTimer);
    this.cleanupMedia();
    this.role = null;
  }
}

export const calls = new CallManager();
