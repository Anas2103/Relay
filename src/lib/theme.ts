import { bubbleLook, colorInfo, FONTS, type Settings, type Theme } from "../../shared/types";
import { setTimeFormat } from "./format";

const STORAGE_KEY = "relay:appearance:v4";
const media = window.matchMedia("(prefers-color-scheme: dark)");

type Appearance = Pick<
  Settings,
  | "theme"
  | "lightTheme"
  | "darkTheme"
  | "accentColor"
  | "bubbleColor"
  | "wallpaper"
  | "uiScale"
  | "messageSize"
  | "font"
  | "bubbleRadius"
  | "density"
  | "chatWidth"
  | "avatarShape"
  | "timeFormat"
  | "animations"
>;
const KEYS: (keyof Appearance)[] = [
  "theme", "lightTheme", "darkTheme", "accentColor", "bubbleColor", "wallpaper", "uiScale", "messageSize",
  "font", "bubbleRadius", "density", "chatWidth", "avatarShape", "timeFormat", "animations",
];
let current: Appearance | null = null;

const DENSITY = {
  compact: { gap: "0.5rem", py: "0.3rem", px: "0.75rem", row: "0.375rem" },
  comfortable: { gap: "0.75rem", py: "0.5rem", px: "0.875rem", row: "0.625rem" },
  spacious: { gap: "1.125rem", py: "0.7rem", px: "1rem", row: "0.875rem" },
} as const;
const WIDTH = { narrow: "38rem", normal: "48rem", wide: "72rem" } as const;
const AVATAR = { circle: "9999px", rounded: "30%", square: "12%" } as const;

/** CSS variables for one mode. The pre-load script (public/theme-init.js) applies these too. */
function variables(a: Appearance, dark: boolean): Record<string, string> {
  const accent = colorInfo(a.accentColor);
  const bubble = bubbleLook(a.bubbleColor);
  const d = DENSITY[a.density] ?? DENSITY.comfortable;
  return {
    "--accent": accent.hex,
    "--accent-ink": accent.ink,
    "--accent-fg": dark ? accent.onDark : accent.onLight,
    "--bubble": bubble.solid,
    "--bubble-bg": bubble.background,
    "--bubble-ink": bubble.ink,
    "--font-sans": (FONTS[a.font] ?? FONTS.system).stack,
    "--ui-scale": String((a.uiScale || 100) / 100),
    "--msg-size": `${a.messageSize || 15}px`,
    "--bubble-radius": `${a.bubbleRadius ?? 18}px`,
    "--group-gap": d.gap,
    "--bubble-py": d.py,
    "--bubble-px": d.px,
    "--row-py": d.row,
    "--chat-max": WIDTH[a.chatWidth] ?? WIDTH.normal,
    "--avatar-radius": AVATAR[a.avatarShape] ?? AVATAR.circle,
  };
}

function isDark(theme: Theme) {
  return theme === "dark" || (theme === "system" && media.matches);
}

function render() {
  if (!current) return;
  const dark = isDark(current.theme);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.lightTheme = current.lightTheme;
  root.dataset.darkTheme = current.darkTheme;
  root.dataset.motion = current.animations ? "on" : "off";
  for (const [k, v] of Object.entries(variables(current, dark))) root.style.setProperty(k, v);
  // Browser UI color (address bar on phones) follows the theme style.
  const surface = getComputedStyle(root).getPropertyValue(dark ? "--color-zinc-900" : "--color-white").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface || (dark ? "#18181b" : "#ffffff"));
}

media.addEventListener("change", () => current?.theme === "system" && render());

/** Applies the appearance now, and remembers it so the next page load starts with the right look. */
export function applyAppearance(settings: Settings, animate = false) {
  const next = Object.fromEntries(KEYS.map((k) => [k, settings[k]])) as Appearance;
  setTimeFormat(settings.timeFormat);
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  current = next;
  if (animate && next.animations) {
    document.documentElement.classList.add("theme-transition");
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 250);
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: next.theme,
        lightTheme: next.lightTheme,
        darkTheme: next.darkTheme,
        motion: next.animations ? "on" : "off",
        light: variables(next, false),
        dark: variables(next, true),
      }),
    );
  } catch {
    // storage unavailable (private mode) — fine
  }
  render();
}

export function currentlyDark() {
  return document.documentElement.classList.contains("dark");
}
