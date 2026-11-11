// Types shared by the Worker (backend) and the React app (frontend).

export type Role = "user" | "admin";

export interface User {
  id: string;
  username: string;
  displayName: string;
  /** null = no profile picture. Changes whenever the picture changes (cache busting). */
  avatarVersion: number | null;
  /** Only present on the signed-in user's own profile. */
  role?: Role;
}

/** The signed-in user, with their private settings. */
export interface Me extends User {
  role: Role;
  bio: string;
  settings: Settings;
}

/** What other people can see when they open your profile. */
export interface Profile extends User {
  bio: string;
  lastSeenAt: number | null;
  createdAt: number;
}

// ---------- Settings ----------

export const BUBBLE_COLORS = {
  indigo: "#4f46e5",
  violet: "#7c3aed",
  pink: "#db2777",
  rose: "#e11d48",
  orange: "#c2410c",
  emerald: "#047857",
  teal: "#0f766e",
  sky: "#0369a1",
  slate: "#334155",
} as const;
export type BubbleColor = keyof typeof BUBBLE_COLORS;
export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  bubbleColor: BubbleColor;
  sounds: boolean;
  notifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  bubbleColor: "indigo",
  sounds: true,
  notifications: false,
};

// ---------- Admin ----------

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  suspendedAt: number | null;
  createdAt: number;
  lastLoginAt: number | null;
  messageCount: number;
  activeSessions: number;
}

export interface AdminStats {
  users: number;
  admins: number;
  suspended: number;
  messages: number;
  rooms: number;
  newUsers7d: number;
  messages24h: number;
  activeSessions: number;
}

export interface AuditEntry {
  id: string;
  adminUsername: string;
  action: string;
  targetUsername: string | null;
  details: string | null;
  createdAt: number;
}

export interface AdminUserUpdate {
  username?: string;
  displayName?: string;
  role?: Role;
  suspended?: boolean;
  password?: string;
}

// ---------- Rooms & messages ----------

export interface Room {
  id: string;
  type: "dm" | "group";
  name: string | null;
  /** For DMs: the other person. */
  peer: User | null;
  lastMessage: { preview: string; createdAt: number; userId: string } | null;
  unreadCount: number;
  createdAt: number;
}

export type MessageKind = "text" | "image" | "voice" | "video" | "file" | "call";
export type MediaKind = Exclude<MessageKind, "text" | "call">;

/** A call record shown in the chat ("Missed video call", "Voice call · 3:20"). */
export interface CallInfo {
  video: boolean;
  status: "ended" | "missed" | "declined" | "busy" | "failed";
  /** Seconds, for calls that connected. */
  duration?: number;
}

export interface MediaMeta {
  mime: string;
  size: number;
  /** Original file name (documents). Taken from the server's stored copy. */
  name?: string;
  width?: number;
  height?: number;
  /** Seconds (voice / video). */
  duration?: number;
  /** 0–1 amplitudes for drawing the voice waveform. */
  waveform?: number[];
  /** Photo can be opened once by each recipient, then it's destroyed. */
  viewOnce?: boolean;
  /** Call records only. */
  call?: CallInfo;
}

// ---------- Calls (WebRTC signaling, relayed by the Lobby) ----------

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type CallSignal =
  | { type: "invite"; sdp: string; video: boolean }
  | { type: "accept"; sdp: string }
  | { type: "ice"; candidate: IceCandidate }
  | { type: "media"; audio: boolean; video: boolean }
  | { type: "decline" }
  | { type: "busy" }
  | { type: "cancel" }
  | { type: "end" }
  /** Sent by the server: the person you're calling has no app open. */
  | { type: "unavailable" }
  /** Sent by the server to your other tabs when you answer/decline on one device. */
  | { type: "handled" };

export const CALL_SIGNAL_TYPES = ["invite", "accept", "ice", "media", "decline", "busy", "cancel", "end"] as const;

/** Browser -> Lobby. */
export interface CallEnvelope {
  type: "call";
  to: string;
  roomId: string;
  callId: string;
  signal: CallSignal;
}

export interface ReplyPreview {
  id: string;
  userId: string;
  displayName: string;
  kind: MessageKind;
  body: string;
  deleted: boolean;
}

export interface Message {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  displayName: string;
  kind: MessageKind;
  body: string;
  mediaId: string | null;
  meta: MediaMeta | null;
  replyTo: ReplyPreview | null;
  /** userId -> emoji */
  reactions: Record<string, string>;
  /** View-once photos: who has opened it. */
  viewedBy: string[];
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  /** Echoed back to the sender so the optimistic copy can be replaced. */
  clientId?: string;
}

/** Browser -> room server over the WebSocket. */
export type ClientEvent =
  | {
      type: "send";
      clientId: string;
      kind: MessageKind;
      body: string;
      mediaId?: string;
      /** Client-measured details; size and type are always taken from the stored file. */
      meta?: Pick<MediaMeta, "width" | "height" | "duration" | "waveform" | "viewOnce" | "call">;
      replyToId?: string;
    }
  | { type: "typing"; isTyping: boolean }
  | { type: "read"; at: number }
  | { type: "react"; messageId: string; emoji: string | null }
  | { type: "edit"; messageId: string; body: string }
  | { type: "delete"; messageId: string };

/** Room server -> browser. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "typing"; userId: string; displayName: string; isTyping: boolean }
  | { type: "presence"; online: string[] }
  | { type: "read"; userId: string; at: number }
  | { type: "reaction"; messageId: string; userId: string; emoji: string | null }
  | { type: "edit"; messageId: string; body: string; editedAt: number }
  | { type: "delete"; messageId: string; deletedAt: number }
  | { type: "viewed"; messageId: string; userId: string }
  | { type: "error"; message: string; clientId?: string };

/** A page of history. `hasMore` = older messages exist; `hasNewer` = newer ones exist (after jumping back in time). */
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  hasNewer: boolean;
  readState: Record<string, number>;
}

export type GalleryTab = "media" | "files" | "links" | "voice";

/** App-wide server -> browser events (sidebar, presence, notifications). */
export type LobbyEvent =
  | { type: "hello"; online: string[] }
  | { type: "presence"; userId: string; online: boolean; lastSeenAt: number | null }
  | {
      type: "activity";
      roomId: string;
      fromUserId: string;
      fromName: string;
      lastMessage: { preview: string; createdAt: number; userId: string };
    }
  | { type: "rooms-changed" }
  | { type: "call"; from: string; fromName: string; roomId: string; callId: string; signal: CallSignal };

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 20,
  displayNameMax: 40,
  bioMax: 160,
  passwordMin: 8,
  passwordMax: 128,
  messageMax: 4000,
  /** Per-kind upload limits. Files are stored in 1 MB chunks, so they can exceed SQLite's 2 MB value cap. */
  uploadMaxBytes: {
    image: 8_000_000,
    voice: 6_000_000,
    video: 20_000_000,
    file: 20_000_000,
  } satisfies Record<MediaKind, number>,
  avatarMaxBytes: 200_000,
  imageMaxDimension: 1600,
  voiceMaxSeconds: 300,
  fileNameMax: 120,
} as const;

export const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"] as const;
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

/** File types that can run code on someone's computer are refused. */
export const BLOCKED_EXTENSIONS = [
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "hta", "cpl", "reg", "lnk", "jar", "dll", "sys", "msc", "application",
];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Text used for sidebar previews and notifications. */
export function messagePreview(m: { kind: MessageKind; body: string; deletedAt?: number | null; meta?: MediaMeta | null }): string {
  if (m.deletedAt) return "Message deleted";
  if (m.kind === "image") return m.meta?.viewOnce ? "📷 View-once photo" : m.body ? `📷 ${m.body}` : "📷 Photo";
  if (m.kind === "video") return m.body ? `🎥 ${m.body}` : "🎥 Video";
  if (m.kind === "voice") return "🎤 Voice message";
  if (m.kind === "file") return `📄 ${m.meta?.name ?? "Document"}`;
  if (m.kind === "call") return callLabel(m.meta?.call);
  return m.body;
}

export function callLabel(call: CallInfo | undefined): string {
  const kind = call?.video ? "video call" : "voice call";
  const icon = call?.video ? "📹" : "📞";
  switch (call?.status) {
    case "missed":
      return `${icon} Missed ${kind}`;
    case "declined":
      return `${icon} Declined ${kind}`;
    case "busy":
      return `${icon} ${capitalize(kind)} · busy`;
    case "failed":
      return `${icon} ${capitalize(kind)} · couldn't connect`;
    default: {
      const d = Math.round(call?.duration ?? 0);
      return `${icon} ${capitalize(kind)}${d ? ` · ${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}` : ""}`;
    }
  }
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
