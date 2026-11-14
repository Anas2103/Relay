import type { CallEnvelope, CallInfo, CallSignal, IceCandidate, LobbyEvent } from "../../shared/types";
import { api } from "./api";
import { createAudioContext, micConstraints, processMic, type AiEngine, type ProcessedMic, type VoiceSettings } from "./audio";
import { canUseDevices, deviceProblem, type DeviceProblem } from "./media";
import { startTone } from "./sound";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  roomId: string | null;
  peerId: string | null;
  peerName: string;
  /** Video call (vs voice only). */
  video: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  peerMicOn: boolean;
  peerCamOn: boolean;
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
};

const RING_TIMEOUT_MS = 45_000;
const RECONNECT_GRACE_MS = 12_000;
const videoConstraints = (facing: "user" | "environment"): MediaTrackConstraints => ({
  facingMode: facing,
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
});

/**
 * One-to-one voice/video calls over WebRTC. Audio and video go directly between
 * the two browsers (peer-to-peer, encrypted by WebRTC's built-in DTLS-SRTP);
 * the server only relays the small setup messages through the Lobby socket.
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
  /** Who to log the call to (the caller writes the record into the chat). */
  onRecord: ((roomId: string, info: CallInfo) => void) | null = null;
  /** Called on an incoming call so the app can show a notification if hidden. */
  onIncoming: ((name: string, video: boolean) => void) | null = null;
  /** Noise suppression / echo cancellation / gain settings (kept in sync with the user's settings). */
  voice: VoiceSettings = { noiseSuppression: "ai", echoCancellation: true, autoGainControl: true, noiseGate: false };
  private rawMic: MediaStream | null = null;
  private processedMic: ProcessedMic | null = null;
  private audioCtx: AudioContext | null = null;

  /**
   * Opens the mic (and camera) and runs the audio through noise suppression.
   * The AudioContext is created synchronously, before any await, so it's allowed
   * to start on iPhones (it must happen inside the tap).
   */
  private async openMic(video: boolean): Promise<MediaStream> {
    this.audioCtx = createAudioContext();
    const raw = navigator.mediaDevices.getUserMedia({
      audio: micConstraints(this.voice),
      video: video ? videoConstraints("user") : false,
    });
    this.audioCtx.resume().catch(() => {});
    this.rawMic = await raw;
    this.processedMic = await processMic(this.rawMic, this.voice, this.audioCtx);
    this.set({ voiceMode: this.processedMic.mode, voiceEngine: this.processedMic.engine ?? null });
    return this.processedMic.stream;
  }

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
      this.set({ playbackStream: remote, incomingCleaned: false });
      return;
    }
    // Chrome only feeds a remote WebRTC stream into Web Audio while it's also attached to a media element.
    this.feeder ??= new Audio();
    this.feeder.muted = true;
    this.feeder.srcObject = remote;
    this.feeder.play().catch(() => {});
    const processed = await processMic(
      new MediaStream(audio),
      { noiseSuppression: "ai", echoCancellation: false, autoGainControl: false, noiseGate: false },
      this.audioCtx,
    );
    if (run !== this.playbackRun) {
      processed.dispose(); // a newer run took over
      return;
    }
    if (processed.mode !== "ai" || this.state.remoteStream !== remote) {
      processed.dispose();
      this.set({ playbackStream: this.state.remoteStream, incomingCleaned: false });
      return;
    }
    this.incomingProcessed = processed;
    this.set({ playbackStream: processed.stream, incomingCleaned: true });
  }

  private releaseMic() {
    this.playbackRun++;
    this.incomingProcessed?.dispose();
    this.incomingProcessed = null;
    if (this.feeder) this.feeder.srcObject = null;
    this.processedMic?.dispose();
    this.processedMic = null;
    this.rawMic?.getTracks().forEach((t) => t.stop());
    this.rawMic = null;
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
      problem,
    });
    if (problem) return this.finish("Can't use the microphone here", null);

    let stream: MediaStream;
    try {
      stream = await this.openMic(video);
    } catch (err) {
      this.set({ problem: deviceProblem(err) });
      return this.finish(video ? "Couldn't start the camera" : "Couldn't start the microphone", null);
    }
    // The user may have hung up while the permission prompt was open.
    if (this.getState().phase !== "outgoing") return this.releaseMic();
    this.set({ localStream: stream });

    try {
      const pc = await this.createPeer();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
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
        camOn: signal.video,
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
        this.set({ peerMicOn: signal.audio, peerCamOn: signal.video });
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

  /** Must be called from a click (mic/camera prompt). */
  async accept() {
    if (this.state.phase !== "incoming" || !this.offerSdp) return;
    window.clearTimeout(this.ringTimer);
    this.stopTone?.();
    const problem = canUseDevices();
    if (problem) {
      this.set({ problem });
      this.signal({ type: "decline" });
      return this.finish("Can't use the microphone here", null);
    }
    this.set({ phase: "connecting" });

    let stream: MediaStream;
    try {
      stream = await this.openMic(this.state.video);
    } catch (err) {
      this.set({ problem: deviceProblem(err) });
      this.signal({ type: "decline" });
      return this.finish(this.state.video ? "Couldn't start the camera" : "Couldn't start the microphone", null);
    }
    this.set({ localStream: stream });

    try {
      const pc = await this.createPeer();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription({ type: "offer", sdp: this.offerSdp });
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal({ type: "accept", sdp: answer.sdp ?? "" });
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
   * Rebuilds the audio processing and swaps the outgoing track in place —
   * no renegotiation, no dropped call.
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

    await rawAudio.applyConstraints(micConstraints(this.voice)).catch(() => {});
    const previous = this.processedMic;
    const processed = await processMic(new MediaStream([rawAudio]), this.voice, this.audioCtx);
    const track = processed.stream.getAudioTracks()[0];
    track.enabled = this.state.micOn;
    await this.pc?.getSenders().find((s) => s.track?.kind === "audio")?.replaceTrack(track).catch(() => {});
    if (previous && previous.stream.getAudioTracks()[0] !== track) previous.dispose();
    this.processedMic = processed;
    const video = this.state.localStream?.getVideoTracks() ?? [];
    this.set({
      localStream: new MediaStream([track, ...video]),
      voiceMode: processed.mode,
      voiceEngine: processed.engine ?? null,
    });
  }

  toggleMic() {
    const track = this.state.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.set({ micOn: track.enabled });
    this.signal({ type: "media", audio: track.enabled, video: this.state.camOn });
  }

  toggleCam() {
    const track = this.state.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.set({ camOn: track.enabled });
    this.signal({ type: "media", audio: this.state.micOn, video: track.enabled });
  }

  /** Front ↔ back camera on phones. */
  async switchCamera() {
    const stream = this.state.localStream;
    const old = stream?.getVideoTracks()[0];
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!stream || !old || !sender) return;
    const facing = this.state.facing === "user" ? "environment" : "user";
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing) });
      const track = fresh.getVideoTracks()[0];
      track.enabled = this.state.camOn;
      await sender.replaceTrack(track);
      old.stop();
      const next = new MediaStream([...stream.getAudioTracks(), track]);
      this.set({ localStream: next, facing });
    } catch {
      // only one camera — ignore
    }
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
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: "ice", candidate: e.candidate.toJSON() as IceCandidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.set({ remoteStream: stream });
      void this.setupPlayback();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        window.clearTimeout(this.reconnectTimer);
        this.set({
          phase: "active",
          reconnecting: false,
          connectedAt: this.state.connectedAt ?? Date.now(),
        });
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
      incomingCleaned: false,
      reconnecting: false,
    });
    this.resetTimer = window.setTimeout(() => this.set({ ...IDLE }), this.state.problem ? 6000 : 1800);
  }

  private cleanupMedia() {
    window.clearTimeout(this.ringTimer);
    window.clearTimeout(this.reconnectTimer);
    this.stopTone?.();
    this.stopTone = null;
    this.state.localStream?.getTracks().forEach((t) => t.stop());
    this.releaseMic();
    try {
      this.pc?.close();
    } catch {
      // already closed
    }
    this.pc = null;
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
