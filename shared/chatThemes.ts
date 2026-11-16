/*
 * Chat themes (like Instagram's): picked per conversation and shared, so
 * everyone in the chat sees the same look. A theme sets the background and
 * the color of outgoing bubbles. Gradient themes span the whole screen, so
 * each bubble shows its own slice of the gradient as you scroll.
 */

export interface ChatTheme {
  label: string;
  /** Outgoing bubbles: 1 color (solid) or 2–3 (gradient, top to bottom of the screen). */
  bubble: string[];
  /** Text on outgoing bubbles. */
  ink: string;
  /** Buttons, links and highlights inside the chat. */
  accent: string;
  /** Background, light and dark mode (top → bottom). */
  wall: { light: [string, string]; dark: [string, string] };
  /** Optional pattern drawn over the background. */
  pattern?: "hearts" | "stars" | "dots" | "waves" | "confetti" | "leaves";
}

export const CHAT_THEMES = {
  classic: {
    label: "Classic",
    bubble: ["#4f46e5"],
    ink: "#ffffff",
    accent: "#4f46e5",
    wall: { light: ["#f8fafc", "#f1f5f9"], dark: ["#0b0b0f", "#0b0b0f"] },
  },
  sunset: {
    label: "Sunset",
    bubble: ["#f59e0b", "#ef4444", "#be185d"],
    ink: "#ffffff",
    accent: "#ea580c",
    wall: { light: ["#fff7ed", "#ffe4e6"], dark: ["#1f0f08", "#2a0b17"] },
  },
  berry: {
    label: "Berry",
    bubble: ["#ec4899", "#a855f7", "#6366f1"],
    ink: "#ffffff",
    accent: "#c026d3",
    wall: { light: ["#fdf4ff", "#eef2ff"], dark: ["#1d0b22", "#10102a"] },
  },
  ocean: {
    label: "Ocean",
    bubble: ["#22d3ee", "#0284c7", "#1e3a8a"],
    ink: "#ffffff",
    accent: "#0284c7",
    wall: { light: ["#ecfeff", "#e0f2fe"], dark: ["#03161d", "#071331"] },
    pattern: "waves",
  },
  aurora: {
    label: "Aurora",
    bubble: ["#34d399", "#06b6d4", "#8b5cf6"],
    ink: "#ffffff",
    accent: "#0d9488",
    wall: { light: ["#ecfdf5", "#f5f3ff"], dark: ["#03191a", "#160f2e"] },
    pattern: "stars",
  },
  love: {
    label: "Love",
    bubble: ["#fb7185", "#e11d48"],
    ink: "#ffffff",
    accent: "#e11d48",
    wall: { light: ["#fff1f2", "#ffe4e6"], dark: ["#22070d", "#2a0a14"] },
    pattern: "hearts",
  },
  lofi: {
    label: "Lo-fi",
    bubble: ["#a78bfa", "#f0abfc"],
    ink: "#2e1065",
    accent: "#7c3aed",
    wall: { light: ["#f5f3ff", "#fdf4ff"], dark: ["#120c22", "#1e0f26"] },
    pattern: "stars",
  },
  forest: {
    label: "Forest",
    bubble: ["#16a34a", "#065f46"],
    ink: "#ffffff",
    accent: "#15803d",
    wall: { light: ["#f0fdf4", "#ecfccb"], dark: ["#06150c", "#0d1a07"] },
    pattern: "leaves",
  },
  citrus: {
    label: "Citrus",
    bubble: ["#facc15", "#fb923c"],
    ink: "#3b1d06",
    accent: "#d97706",
    wall: { light: ["#fefce8", "#fff7ed"], dark: ["#1c1803", "#211104"] },
  },
  candy: {
    label: "Cotton candy",
    bubble: ["#f9a8d4", "#93c5fd"],
    ink: "#1e1b4b",
    accent: "#db2777",
    wall: { light: ["#fdf2f8", "#eff6ff"], dark: ["#1f0b18", "#0b1428"] },
    pattern: "dots",
  },
  midnight: {
    label: "Midnight",
    bubble: ["#3730a3", "#1e1b4b"],
    ink: "#ffffff",
    accent: "#6366f1",
    wall: { light: ["#eef2ff", "#e0e7ff"], dark: ["#05061a", "#0a0a24"] },
    pattern: "stars",
  },
  mono: {
    label: "Monochrome",
    bubble: ["#27272a"],
    ink: "#ffffff",
    accent: "#52525b",
    wall: { light: ["#fafafa", "#f4f4f5"], dark: ["#09090b", "#09090b"] },
  },
  party: {
    label: "Party",
    bubble: ["#f43f5e", "#f59e0b", "#22c55e"],
    ink: "#ffffff",
    accent: "#e11d48",
    wall: { light: ["#fffbeb", "#fdf2f8"], dark: ["#1c1206", "#200a16"] },
    pattern: "confetti",
  },
  lavender: {
    label: "Lavender",
    bubble: ["#c4b5fd", "#a78bfa"],
    ink: "#2e1065",
    accent: "#7c3aed",
    wall: { light: ["#faf5ff", "#f5f3ff"], dark: ["#140d22", "#120c1f"] },
  },
  peach: {
    label: "Peach",
    bubble: ["#fdba74", "#fda4af"],
    ink: "#431407",
    accent: "#ea580c",
    wall: { light: ["#fff7ed", "#fff1f2"], dark: ["#200f05", "#220a0d"] },
  },
  ice: {
    label: "Ice",
    bubble: ["#bae6fd", "#7dd3fc"],
    ink: "#0c4a6e",
    accent: "#0284c7",
    wall: { light: ["#f0f9ff", "#f8fafc"], dark: ["#06121b", "#0a1219"] },
    pattern: "dots",
  },
  fire: {
    label: "Fire",
    bubble: ["#fde047", "#f97316", "#b91c1c"],
    ink: "#ffffff",
    accent: "#dc2626",
    wall: { light: ["#fff7ed", "#fef2f2"], dark: ["#1f0a03", "#220505"] },
  },
  matrix: {
    label: "Terminal",
    bubble: ["#22c55e", "#15803d"],
    ink: "#052e16",
    accent: "#16a34a",
    wall: { light: ["#f0fdf4", "#f0fdf4"], dark: ["#020a04", "#020a04"] },
    pattern: "dots",
  },
  coffee: {
    label: "Coffee",
    bubble: ["#a16207", "#78350f"],
    ink: "#ffffff",
    accent: "#a16207",
    wall: { light: ["#fefaf3", "#f5ede0"], dark: ["#16100a", "#1c140c"] },
  },
  galaxy: {
    label: "Galaxy",
    bubble: ["#c026d3", "#4f46e5", "#0ea5e9"],
    ink: "#ffffff",
    accent: "#9333ea",
    wall: { light: ["#f5f3ff", "#ecfeff"], dark: ["#0c0420", "#03101f"] },
    pattern: "stars",
  },
} as const satisfies Record<string, ChatTheme>;

export type ChatThemeId = keyof typeof CHAT_THEMES;

export function isChatTheme(v: unknown): v is ChatThemeId {
  return typeof v === "string" && Object.hasOwn(CHAT_THEMES, v);
}

/** CSS for a theme's outgoing bubbles. */
export function themeBubble(t: ChatTheme): string {
  return t.bubble.length === 1 ? t.bubble[0] : `linear-gradient(180deg, ${t.bubble.join(", ")})`;
}
