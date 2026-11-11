import { PALETTE, type ColorName, type Settings, type Theme, type Wallpaper } from "../../shared/types";

const STORAGE_KEY = "relay:appearance:v2";
const media = window.matchMedia("(prefers-color-scheme: dark)");

type Appearance = Pick<Settings, "theme" | "accentColor" | "bubbleColor" | "wallpaper">;
let current: Appearance | null = null;

/** CSS variables for one mode. The pre-load script (public/theme-init.js) applies these too. */
function variables(a: Appearance, dark: boolean): Record<string, string> {
  const accent = PALETTE[a.accentColor] ?? PALETTE.indigo;
  const bubble = PALETTE[a.bubbleColor] ?? PALETTE.indigo;
  return {
    "--accent": accent.hex,
    "--accent-ink": accent.ink,
    "--accent-fg": dark ? accent.onDark : accent.onLight,
    "--bubble": bubble.hex,
    "--bubble-ink": bubble.ink,
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
  for (const [k, v] of Object.entries(variables(current, dark))) root.style.setProperty(k, v);
  root.dataset.wallpaper = current.wallpaper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#09090b" : "#ffffff");
}

media.addEventListener("change", () => current?.theme === "system" && render());

/** Applies the appearance now, and remembers it so the next page load starts with the right colors. */
export function applyAppearance(settings: Appearance, animate = false) {
  const next: Appearance = {
    theme: settings.theme,
    accentColor: settings.accentColor,
    bubbleColor: settings.bubbleColor,
    wallpaper: settings.wallpaper,
  };
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  current = next;
  if (animate) {
    document.documentElement.classList.add("theme-transition");
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 250);
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: next.theme,
        wallpaper: next.wallpaper,
        light: variables(next, false),
        dark: variables(next, true),
      }),
    );
  } catch {
    // storage unavailable (private mode) — fine
  }
  render();
}

/** For live previews in Settings (e.g. showing a bubble color before it's chosen). */
export function paletteVars(name: ColorName, dark: boolean) {
  const c = PALETTE[name];
  return { bg: c.hex, ink: c.ink, fg: dark ? c.onDark : c.onLight };
}

export function currentlyDark() {
  return document.documentElement.classList.contains("dark");
}

export type { Wallpaper };
