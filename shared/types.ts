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
  /** Discord-style custom status, e.g. "🎮 Playing". Empty = none. */
  statusText?: string;
}

/** The signed-in user, with their private settings. */
export interface Me extends User {
  role: Role;
  /** Site owner (Grimm): the only account that can review conversations. Every access is audited. */
  superAdmin: boolean;
  bio: string;
  settings: Settings;
  statusText: string;
  /** Two-step verification is on. */
  twoFactor: boolean;
}

/** A signed-in device (Settings → Privacy & security → Devices). */
export interface SessionInfo {
  /** Short public id (not the secret token). */
  id: string;
  device: string;
  location: string;
  createdAt: number;
  lastActiveAt: number;
  current: boolean;
}

export interface SecurityOverview {
  twoFactor: boolean;
  recoveryCodesLeft: number;
  sessionIdleDays: number;
  sessions: SessionInfo[];
}

/** "Automatically sign out devices that haven't been used for…" */
export const SESSION_IDLE_OPTIONS = [7, 30, 90, 180, 365] as const;

/** What other people can see when they open your profile. */
export interface Profile extends User {
  bio: string;
  lastSeenAt: number | null;
  createdAt: number;
  statusText: string;
  /** They turned on Do Not Disturb. */
  dnd: boolean;
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
  sand: { label: "Sand", hex: "#e7d7b8", ink: "#3b2a12", onLight: "#92400e", onDark: "#e7d7b8" },
  // More deep colors (white text)
  navy: { label: "Navy", hex: "#1e3a8a", ink: "#ffffff", onLight: "#1e3a8a", onDark: "#93c5fd" },
  plum: { label: "Plum", hex: "#86198f", ink: "#ffffff", onLight: "#86198f", onDark: "#f0abfc" },
  olive: { label: "Olive", hex: "#4d7c0f", ink: "#ffffff", onLight: "#4d7c0f", onDark: "#bef264" },
} as const satisfies Record<string, PaletteColor>;

export type ColorName = keyof typeof PALETTE;
/** A custom color picked with the color picker. */
export type HexColor = `#${string}`;
/** App color: a palette color or any custom color. */
export type AccentColor = ColorName | HexColor;

export function isHexColor(v: unknown): v is HexColor {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

// ---- Contrast math (WCAG), so custom colors always stay readable ----
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Mixes a color toward white (dark backgrounds) or black (light ones) until it's readable on `background`. */
function readableOn(hex: string, background: string, target = 4.5): string {
  if (contrast(hex, background) >= target) return hex;
  const towardWhite = luminance(background) < 0.2;
  const base = rgb(hex);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = base.map((c) => (towardWhite ? c + (255 - c) * t : c * (1 - t))) as [number, number, number];
    const out = toHex(mixed);
    if (contrast(out, background) >= target) return out;
  }
  return towardWhite ? "#ffffff" : "#000000";
}
/** Palette entry for any color: picks readable text colors automatically for custom ones. */
export function colorInfo(color: AccentColor): PaletteColor {
  if (isHexColor(color)) {
    const ink = contrast(color, "#ffffff") >= contrast(color, DARK_INK) ? "#ffffff" : DARK_INK;
    return { label: "Custom", hex: color, ink, onLight: readableOn(color, "#ffffff"), onDark: readableOn(color, "#18181b") };
  }
  return PALETTE[color in PALETTE ? color : "indigo"];
}

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
  "g-tropical": { label: "Tropical", from: "#0e7490", to: "#15803d", ink: "#ffffff" },
  "g-dusk": { label: "Dusk", from: "#9a3412", to: "#4c1d95", ink: "#ffffff" },
  "g-lagoon": { label: "Lagoon", from: "#0369a1", to: "#0f766e", ink: "#ffffff" },
  "g-gold": { label: "Gold", from: "#facc15", to: "#fb923c", ink: "#3b1d06" },
  "g-rosegold": { label: "Rose gold", from: "#fda4af", to: "#fcd34d", ink: "#4c0519" },
  "g-mono": { label: "Mono", from: "#3f3f46", to: "#18181b", ink: "#ffffff" },
} as const satisfies Record<string, BubbleGradient>;

export type GradientName = keyof typeof GRADIENTS;
export type BubbleStyle = ColorName | GradientName | HexColor;
/** Kept for older code paths. */
export type BubbleColor = BubbleStyle;

/** What a bubble style looks like: a CSS background, readable text, and a solid fallback color. */
export function bubbleLook(style: BubbleStyle): { background: string; ink: string; solid: string } {
  if (isHexColor(style)) {
    const c = colorInfo(style);
    return { background: c.hex, ink: c.ink, solid: c.hex };
  }
  if (style in GRADIENTS) {
    const g = GRADIENTS[style as GradientName];
    return { background: `linear-gradient(135deg, ${g.from}, ${g.to})`, ink: g.ink, solid: g.to };
  }
  const c = PALETTE[(style as ColorName) in PALETTE ? (style as ColorName) : "indigo"];
  return { background: c.hex, ink: c.ink, solid: c.hex };
}

export type Theme = "system" | "light" | "dark";

/** Styles for each mode. "System" uses your light style by day and dark style by night. */
export const LIGHT_THEMES = { classic: "Classic", cream: "Cream", cool: "Cool", rose: "Rose", mint: "Mint", lilac: "Lilac", sky: "Sky", sand: "Sand", peach: "Peach", fog: "Fog" } as const;
export const DARK_THEMES = { classic: "Classic", dim: "Dim", amoled: "AMOLED black", midnight: "Midnight", forest: "Forest", wine: "Wine", ocean: "Ocean", mocha: "Mocha", grape: "Grape", nordic: "Nordic", slate: "Slate", plum: "Plum" } as const;
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
  sky: "Sky",
  cherry: "Cherry",
  sand: "Sand",
  bubbles: "Bubbles",
} as const;
export type Wallpaper = keyof typeof WALLPAPERS;

export type NoiseSuppression = "ai" | "standard" | "off";

/** Font choices use fonts already on the device (nothing is downloaded). */
export const FONTS = {
  system: { label: "System", stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  rounded: { label: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", "Arial Rounded MT Bold", system-ui, sans-serif' },
  serif: { label: "Serif", stack: 'ui-serif, "New York", Georgia, Cambria, "Times New Roman", serif' },
  mono: { label: "Mono", stack: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace' },
  humanist: { label: "Humanist", stack: '"Segoe UI", "Gill Sans", "Trebuchet MS", Candara, Optima, sans-serif' },
  playful: { label: "Playful", stack: '"Comic Neue", "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive' },
} as const;
export type FontName = keyof typeof FONTS;
export type Density = "compact" | "comfortable" | "spacious";
export type ChatWidth = "narrow" | "normal" | "wide";
export type AvatarShape = "circle" | "rounded" | "square";
export type TimeFormat = "auto" | "12h" | "24h";
/** Who can see when you were last online ("contacts" = people you have an accepted chat with). */
export type LastSeenVisibility = "contacts" | "nobody";
/** Discord-style: online, Do Not Disturb (no alerts or sounds), or invisible (appear offline). */
export type PresenceMode = "online" | "dnd" | "invisible";

export interface Settings {
  theme: Theme;
  lightTheme: LightTheme;
  darkTheme: DarkTheme;
  /** App color: buttons, links, badges, highlights. */
  accentColor: AccentColor;
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
  /** Also run AI noise suppression on the other person's voice, on your side. */
  cleanIncoming: boolean;

  // ---- Text & layout ----
  /** Whole-app size, in percent (85–125). */
  uiScale: number;
  /** Message text size in px (12–22). */
  messageSize: number;
  font: FontName;
  /** Bubble corner roundness in px (4–24). */
  bubbleRadius: number;
  density: Density;
  chatWidth: ChatWidth;
  avatarShape: AvatarShape;
  timeFormat: TimeFormat;
  /** Messages made of only 1–3 emoji are shown large. */
  bigEmoji: boolean;
  animations: boolean;
  /** Chat list: show the last message under each chat. */
  listPreviews: boolean;
  /** Chat list: the "Online now" row. */
  showOnlineRow: boolean;

  // ---- Chats ----
  /** Desktop: Enter sends (Shift+Enter = new line). Off: Ctrl/Cmd+Enter sends. */
  enterToSend: boolean;
  linkPreviews: boolean;
  /** Let others see when you're typing. */
  sendTyping: boolean;
  /** Notifications show the message text (off: just who it's from). */
  notificationPreview: boolean;

  // ---- Privacy ----
  lastSeen: LastSeenVisibility;
  presence: PresenceMode;
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
  cleanIncoming: false,
  uiScale: 100,
  messageSize: 15,
  font: "system",
  bubbleRadius: 18,
  density: "comfortable",
  chatWidth: "normal",
  avatarShape: "circle",
  timeFormat: "auto",
  bigEmoji: true,
  animations: true,
  listPreviews: true,
  showOnlineRow: true,
  enterToSend: true,
  linkPreviews: true,
  sendTyping: true,
  notificationPreview: true,
  lastSeen: "contacts",
  presence: "online",
};

export function isColorName(v: unknown): v is ColorName {
  return typeof v === "string" && Object.hasOwn(PALETTE, v);
}
export function isAccentColor(v: unknown): v is AccentColor {
  return isColorName(v) || isHexColor(v);
}
export function isBubbleStyle(v: unknown): v is BubbleStyle {
  return isColorName(v) || isHexColor(v) || (typeof v === "string" && Object.hasOwn(GRADIENTS, v));
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
  /** Site owner (can review conversations). */
  superAdmin: boolean;
  suspendedAt: number | null;
  createdAt: number;
  lastLoginAt: number | null;
  messageCount: number;
  activeSessions: number;
  avatarVersion: number | null;
  /** Has the app open right now. */
  online: boolean;
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
  /** Accounts that can review conversations (should be exactly 1: Grimm). */
  owners: number;
  onlineNow: number;
  pendingRequests: number;
  /** Last 14 days, oldest first. `day` is YYYY-MM-DD (UTC). */
  daily: { day: string; messages: number; signups: number }[];
  /** Most messages in the last 7 days. */
  topSenders: { id: string; username: string; displayName: string; avatarVersion: number | null; messages: number }[];
}

export interface AuditEntry {
  id: string;
  adminUsername: string;
  action: string;
  targetUsername: string | null;
  details: string | null;
  createdAt: number;
}

export interface AdminRoom {
  id: string;
  type: "dm" | "group";
  /** End-to-end encrypted secret chat: the owner can see who and when, never what. */
  secret: boolean;
  /** Group name. */
  name: string | null;
  status: "pending" | "accepted";
  members: { id: string; username: string; displayName: string; avatarVersion: number | null }[];
  messageCount: number;
  /** Preview of the latest message (view-once content never included). */
  lastPreview: string | null;
  lastActivity: number;
  createdAt: number;
}

export interface AdminUserUpdate {
  username?: string;
  displayName?: string;
  role?: Role;
  suspended?: boolean;
  password?: string;
  /** Turns off the user's two-step verification (they lost their phone and recovery codes). */
  resetTwoFactor?: boolean;
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
  /** "pending" = a friend request that hasn't been accepted yet (no messages allowed). */
  status: "pending" | "accepted";
  /** Who sent the request (pending rooms only). */
  requestedBy: string | null;
  /** You blocked the other person (you can unblock). */
  blocked: boolean;
  /** The other person blocked you. */
  blockedMe: boolean;
  /** Your role in this chat (groups: admins can rename, add and remove people). */
  role: "member" | "admin";
  memberCount: number;
  /** Disappearing messages timer in ms, or null when off. */
  disappearMs: number | null;
  /** End-to-end encrypted secret chat (1:1, readable only on the two devices that set it up). */
  secret: boolean;
  /** "Saved Messages": your own private notepad. */
  saved: boolean;
  /** Your own chat-list preferences. */
  pinned: boolean;
  archived: boolean;
  /** Muted until this time (ms), or null. MUTE_FOREVER = muted until you unmute. */
  mutedUntil: number | null;
  /** Groups: only admins can send messages (an announcement channel). */
  adminsOnly: boolean;
  /** Groups: members can send one message every this many ms (0 = off). Admins are exempt. */
  slowModeMs: number;
  /** Groups: the invite link code (only shown to group admins). */
  inviteCode: string | null;
  /** Unread messages that @mention you. */
  mentions: number;
  /** Groups: the group photo (null = none). Changes whenever the photo changes. */
  avatarVersion: number | null;
}

/** Someone banned from a group (can't rejoin with an invite link). */
export interface GroupBan {
  id: string;
  username: string;
  displayName: string;
  avatarVersion: number | null;
  bannedAt: number;
}

export const REPORT_REASONS = {
  spam: "Spam or scam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  violence: "Violence or threats",
  sexual: "Sexual content",
  impersonation: "Pretending to be someone",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** A report, as admins see it. */
export interface AdminReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
  reporter: { id: string; username: string; displayName: string } | null;
  target: { id: string; username: string; displayName: string; suspended: boolean } | null;
  roomId: string | null;
  /** What was reported, copied at the time of the report. */
  snapshot: { kind: MessageKind; body: string; createdAt: number; encrypted?: boolean } | null;
  resolvedBy: string | null;
}

/** A message waiting to be sent at a set time (Telegram's "Schedule message"). */
export interface ScheduledMessage {
  id: string;
  body: string;
  sendAt: number;
  silent: boolean;
  replyToId: string | null;
}

export const SCHEDULE_MAX_DAYS = 365;

/** What someone sees before joining a group from an invite link. */
export interface InvitePreview {
  code: string;
  roomId: string;
  name: string;
  memberCount: number;
  /** Already in the group. */
  member: boolean;
}

export const SLOW_MODE_OPTIONS: { label: string; ms: number }[] = [
  { label: "Off", ms: 0 },
  { label: "10 seconds", ms: 10_000 },
  { label: "30 seconds", ms: 30_000 },
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 300_000 },
  { label: "15 minutes", ms: 900_000 },
  { label: "1 hour", ms: 3_600_000 },
];

/** @username mentions inside a message. */
export const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9_]{3,20})(?!\w)/g;

export function mentionedUsernames(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

/** Public keys of a secret chat's two devices. Private keys never leave the device. */
export interface SecretInfo {
  roomId: string;
  initiatorId: string;
  keys: { userId: string; deviceId: string; publicKey: string }[];
}

/** Encrypted message bodies: prefix + base64url(12-byte IV) + "." + base64url(ciphertext). */
export const E2E_PREFIX = "e2e1.";
export const E2E_RE = /^e2e1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,32000}$/;

export function isEncrypted(body: string): boolean {
  return body.startsWith(E2E_PREFIX);
}

export const MUTE_FOREVER = 32503680000000; // year 3000

export function isMuted(room: Pick<Room, "mutedUntil">, now = Date.now()): boolean {
  return room.mutedUntil !== null && room.mutedUntil > now;
}

/** A person in a group, as shown in group info. */
export interface GroupMember extends User {
  groupRole: "member" | "admin";
}

/** Timers you can pick for disappearing messages. */
export const DISAPPEAR_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "Off", ms: null },
  { label: "30 seconds", ms: 30 * 1000 },
  { label: "5 minutes", ms: 5 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "90 days", ms: 90 * 24 * 60 * 60 * 1000 },
];

export function disappearLabel(ms: number | null): string {
  return DISAPPEAR_OPTIONS.find((o) => o.ms === ms)?.label ?? "Custom";
}

/** Title, description and site name of a web page (never images: they'd load from other sites). */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
}

/** Owner-controlled, site-wide settings. */
export interface SiteSettings {
  /** Banner shown to everyone, or null. */
  announcement: { text: string; createdAt: number } | null;
  /** Whether new people can create accounts. */
  registrationOpen: boolean;
  /** While on, only admins can use the app; everyone else sees a maintenance screen. */
  maintenance: boolean;
}

/** A person you've blocked (for the settings list). */
export interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  avatarVersion: number | null;
  blockedAt: number;
}

export type MessageKind = "text" | "image" | "voice" | "video" | "file" | "call" | "poll";
export type MediaKind = Exclude<MessageKind, "text" | "call" | "poll">;

/** A poll: the question is the message body. */
export interface PollInfo {
  options: string[];
  /** People can pick more than one answer. */
  multiple: boolean;
}

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
  /** Sent with "Forward". */
  forwarded?: boolean;
  /** Poll messages only. */
  poll?: PollInfo;
  /** Sent without sound (no alerts for the people receiving it). */
  silent?: boolean;
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
  /** Pinned to the top of the chat (shared by everyone). */
  pinnedAt: number | null;
  /** Disappearing messages: when it will be removed. */
  expiresAt: number | null;
  /** Polls: userId -> the options they picked. */
  votes?: Record<string, number[]>;
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
      meta?: Pick<MediaMeta, "width" | "height" | "duration" | "waveform" | "viewOnce" | "call" | "forwarded" | "poll">;
      replyToId?: string;
      /** No alerts or sounds for the people receiving it. */
      silent?: boolean;
    }
  | { type: "vote"; messageId: string; options: number[] }
  | { type: "schedule"; clientId: string; body: string; sendAt: number; replyToId?: string; silent?: boolean }
  | { type: "unschedule"; id: string }
  | { type: "send-now"; id: string }
  | { type: "list-scheduled" }
  | { type: "typing"; isTyping: boolean }
  | { type: "read"; at: number }
  | { type: "react"; messageId: string; emoji: string | null }
  | { type: "edit"; messageId: string; body: string }
  | { type: "delete"; messageId: string }
  | { type: "pin"; messageId: string; pinned: boolean };

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
  | { type: "pin"; messageId: string; pinnedAt: number | null }
  | { type: "expired"; messageIds: string[] }
  | { type: "votes"; messageId: string; votes: Record<string, number[]> }
  /** Your scheduled messages in this chat (only ever sent to you). */
  | { type: "scheduled"; items: ScheduledMessage[] }
  | { type: "error"; message: string; clientId?: string };

/** A page of history. `hasMore` = older messages exist; `hasNewer` = newer ones exist (after jumping back in time). */
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  hasNewer: boolean;
  readState: Record<string, number>;
}

export type GalleryTab = "media" | "files" | "links" | "voice";
/** Extra tabs in chat info that come from their own endpoints. */
export type InfoTab = GalleryTab | "starred" | "members";

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
      /** Sent without sound. */
      silent?: boolean;
      /** People @mentioned in it (they get alerted even in muted chats). */
      mentions?: string[];
    }
  /** Security alert for your other devices ("New sign-in on Chrome · Windows"). */
  | { type: "security"; title: string; text: string }
  /** This device was signed out from another one. */
  | { type: "signed-out" }
  | { type: "rooms-changed" }
  | { type: "site-changed" }
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
  groupNameMax: 50,
  announcementMax: 500,
  /** Encrypted bodies are longer than the text inside them. */
  cipherMax: 24_000,
  statusMax: 70,
  pollQuestionMax: 300,
  pollOptionMax: 100,
  pollOptionsMin: 2,
  pollOptionsMax: 10,
  reportDetailsMax: 1000,
  scheduledPerChat: 50,
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
  if (isEncrypted(m.body)) return "🔒 Encrypted message";
  if (m.kind === "image") return m.meta?.viewOnce ? "📷 View-once photo" : m.body ? `📷 ${m.body}` : "📷 Photo";
  if (m.kind === "video") return m.meta?.viewOnce ? "🎥 View-once video" : m.body ? `🎥 ${m.body}` : "🎥 Video";
  if (m.kind === "voice") return "🎤 Voice message";
  if (m.kind === "file") return `📄 ${m.meta?.name ?? "Document"}`;
  if (m.kind === "call") return callLabel(m.meta?.call);
  if (m.kind === "poll") return `📊 ${m.body}`;
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
