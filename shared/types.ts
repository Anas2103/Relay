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
  /** Their chosen bubble style, shown to others (who can turn this off). */
  bubbleColor?: BubbleStyle;
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

/**
 * Every color comes with the text colors that stay readable with it:
 *  - `ink`:     text drawn ON the color (white on deep colors, dark on light ones)
 *  - `onLight`: the color used as text on a light background
 *  - `onDark`:  the color used as text on a dark background
 * All pairs meet WCAG AA (4.5:1) — checked by a script against white and zinc-900.
 */
export interface PaletteColor {
  label: string;
  hex: string;
  ink: string;
  onLight: string;
  onDark: string;
}

const DARK_INK = "#1c1917";

export const PALETTE = {
  // Deep colors (white text)
  red: { label: "Red", hex: "#dc2626", ink: "#ffffff", onLight: "#dc2626", onDark: "#fca5a5" },
  rose: { label: "Rose", hex: "#e11d48", ink: "#ffffff", onLight: "#e11d48", onDark: "#fda4af" },
  pink: { label: "Pink", hex: "#db2777", ink: "#ffffff", onLight: "#db2777", onDark: "#f9a8d4" },
  fuchsia: { label: "Fuchsia", hex: "#a21caf", ink: "#ffffff", onLight: "#a21caf", onDark: "#f0abfc" },
  purple: { label: "Purple", hex: "#9333ea", ink: "#ffffff", onLight: "#9333ea", onDark: "#d8b4fe" },
  violet: { label: "Violet", hex: "#7c3aed", ink: "#ffffff", onLight: "#7c3aed", onDark: "#c4b5fd" },
  indigo: { label: "Indigo", hex: "#4f46e5", ink: "#ffffff", onLight: "#4f46e5", onDark: "#a5b4fc" },
  blue: { label: "Blue", hex: "#2563eb", ink: "#ffffff", onLight: "#2563eb", onDark: "#93c5fd" },
  sky: { label: "Ocean", hex: "#0369a1", ink: "#ffffff", onLight: "#0369a1", onDark: "#7dd3fc" },
  cyan: { label: "Cyan", hex: "#0e7490", ink: "#ffffff", onLight: "#0e7490", onDark: "#67e8f9" },
  teal: { label: "Teal", hex: "#0f766e", ink: "#ffffff", onLight: "#0f766e", onDark: "#5eead4" },
  emerald: { label: "Emerald", hex: "#047857", ink: "#ffffff", onLight: "#047857", onDark: "#6ee7b7" },
  green: { label: "Green", hex: "#15803d", ink: "#ffffff", onLight: "#15803d", onDark: "#86efac" },
  orange: { label: "Orange", hex: "#c2410c", ink: "#ffffff", onLight: "#c2410c", onDark: "#fdba74" },
  coffee: { label: "Coffee", hex: "#7c4a2d", ink: "#ffffff", onLight: "#7c4a2d", onDark: "#e7c9a9" },
  slate: { label: "Graphite", hex: "#334155", ink: "#ffffff", onLight: "#334155", onDark: "#cbd5e1" },
  // Light colors (dark text)
  yellow: { label: "Yellow", hex: "#facc15", ink: DARK_INK, onLight: "#a16207", onDark: "#fde047" },
  amber: { label: "Amber", hex: "#f59e0b", ink: DARK_INK, onLight: "#b45309", onDark: "#fcd34d" },
  lime: { label: "Lime", hex: "#a3e635", ink: "#1a2e05", onLight: "#4d7c0f", onDark: "#bef264" },
  mint: { label: "Mint", hex: "#6ee7b7", ink: "#022c22", onLight: "#047857", onDark: "#6ee7b7" },
  babyblue: { label: "Baby blue", hex: "#7dd3fc", ink: "#082f49", onLight: "#0369a1", onDark: "#7dd3fc" },
  lavender: { label: "Lavender", hex: "#c4b5fd", ink: "#2e1065", onLight: "#6d28d9", onDark: "#c4b5fd" },
  blush: { label: "Blush", hex: "#f9a8d4", ink: "#500724", onLight: "#be185d", onDark: "#f9a8d4" },
  peach: { label: "Peach", hex: "#fdba74", ink: "#431407", onLight: "#c2410c", onDark: "#fdba74" },
} as const satisfies Record<string, PaletteColor>;

export type ColorName = keyof typeof PALETTE;

/** Gradient bubbles (bubbles only — the app color is always a solid color). */
export interface BubbleGradient {
  label: string;
  from: string;
  to: string;
  ink: string;
}

export const GRADIENTS = {
  "g-sunset": { label: "Sunset", from: "#c2410c", to: "#be185d", ink: "#ffffff" },
  "g-berry": { label: "Berry", from: "#be185d", to: "#7e22ce", ink: "#ffffff" },
  "g-ocean": { label: "Deep sea", from: "#0369a1", to: "#4338ca", ink: "#ffffff" },
  "g-aurora": { label: "Aurora", from: "#0f766e", to: "#1d4ed8", ink: "#ffffff" },
  "g-forest": { label: "Forest", from: "#15803d", to: "#0f766e", ink: "#ffffff" },
  "g-fire": { label: "Fire", from: "#b91c1c", to: "#c2410c", ink: "#ffffff" },
  "g-night": { label: "Night", from: "#1e1b4b", to: "#6d28d9", ink: "#ffffff" },
  "g-candy": { label: "Cotton candy", from: "#f9a8d4", to: "#c4b5fd", ink: "#3b0764" },
  "g-peachy": { label: "Peachy", from: "#fed7aa", to: "#fbcfe8", ink: "#431407" },
  "g-citrus": { label: "Citrus", from: "#fde047", to: "#86efac", ink: "#14532d" },
} as const satisfies Record<string, BubbleGradient>;

export type GradientName = keyof typeof GRADIENTS;
export type BubbleStyle = ColorName | GradientName;
/** Kept for older code paths. */
export type BubbleColor = BubbleStyle;

/** What a bubble style looks like: a CSS background, readable text, and a solid fallback color. */
export function bubbleLook(style: BubbleStyle): { background: string; ink: string; solid: string } {
  if (style in GRADIENTS) {
    const g = GRADIENTS[style as GradientName];
    return { background: `linear-gradient(135deg, ${g.from}, ${g.to})`, ink: g.ink, solid: g.to };
  }
  const c = PALETTE[(style as ColorName) in PALETTE ? (style as ColorName) : "indigo"];
  return { background: c.hex, ink: c.ink, solid: c.hex };
}

export type Theme = "system" | "light" | "dark";

/** Styles for each mode. "System" uses your light style by day and dark style by night. */
export const LIGHT_THEMES = { classic: "Classic", cream: "Cream", cool: "Cool" } as const;
export const DARK_THEMES = { classic: "Classic", dim: "Dim", amoled: "AMOLED black", midnight: "Midnight" } as const;
export type LightTheme = keyof typeof LIGHT_THEMES;
export type DarkTheme = keyof typeof DARK_THEMES;

export const WALLPAPERS = {
  plain: "Plain",
  dots: "Dots",
  grid: "Grid",
  hearts: "Hearts",
  stars: "Stars",
  waves: "Waves",
  confetti: "Confetti",
  aurora: "Aurora",
  sunset: "Sunset",
  ocean: "Ocean",
  forest: "Forest",
  lavender: "Lavender",
  rose: "Rose",
  peach: "Peach",
  mint: "Mint",
  galaxy: "Galaxy",
} as const;
export type Wallpaper = keyof typeof WALLPAPERS;

export type NoiseSuppression = "ai" | "standard" | "off";

export interface Settings {
  theme: Theme;
  lightTheme: LightTheme;
  darkTheme: DarkTheme;
  /** App color: buttons, links, badges, highlights. */
  accentColor: ColorName;
  /** Your own message bubbles — also shown to the people you chat with. */
  bubbleColor: BubbleStyle;
  /** Show other people's chosen bubble colors on their messages (Instagram/TikTok-style). */
  showOthersBubbles: boolean;
  /** Background behind the messages. */
  wallpaper: Wallpaper;
  sounds: boolean;
  notifications: boolean;
  // Voice processing for calls and voice messages (Discord-style)
  noiseSuppression: NoiseSuppression;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Silences the background between words. */
  noiseGate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  lightTheme: "classic",
  darkTheme: "classic",
  accentColor: "indigo",
  bubbleColor: "indigo",
  showOthersBubbles: true,
  wallpaper: "plain",
  sounds: true,
  notifications: false,
  noiseSuppression: "ai",
  echoCancellation: true,
  autoGainControl: true,
  noiseGate: false,
};

export function isColorName(v: unknown): v is ColorName {
  return typeof v === "string" && Object.hasOwn(PALETTE, v);
}
export function isBubbleStyle(v: unknown): v is BubbleStyle {
  return isColorName(v) || (typeof v === "string" && Object.hasOwn(GRADIENTS, v));
}
export function isWallpaper(v: unknown): v is Wallpaper {
  return typeof v === "string" && Object.hasOwn(WALLPAPERS, v);
}
export function isLightTheme(v: unknown): v is LightTheme {
  return typeof v === "string" && Object.hasOwn(LIGHT_THEMES, v);
}
export function isDarkTheme(v: unknown): v is DarkTheme {
  return typeof v === "string" && Object.hasOwn(DARK_THEMES, v);
}

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
