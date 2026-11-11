import { bubbleLook, PALETTE, type Settings, type Theme } from "../../shared/types";

const STORAGE_KEY = "relay:appearance:v3";
const media = window.matchMedia("(prefers-color-scheme: dark)");

type Appearance = Pick<Settings, "theme" | "lightTheme" | "darkTheme" | "accentColor" | "bubbleColor" | "wallpaper">;
let current: Appearance | null = null;

/** CSS variables for one mode. The pre-load script (public/theme-init.js) applies these too. */
function variables(a: Appearance, dark: boolean): Record<string, string> {
  const accent = PALETTE[a.accentColor] ?? PALETTE.indigo;
  const bubble = bubbleLook(a.bubbleColor);
  return {
    "--accent": accent.hex,
    "--accent-ink": accent.ink,
    "--accent-fg": dark ? accent.onDark : accent.onLight,
    "--bubble": bubble.solid,
    "--bubble-bg": bubble.background,
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
  root.dataset.lightTheme = current.lightTheme;
  root.dataset.darkTheme = current.darkTheme;
  for (const [k, v] of Object.entries(variables(current, dark))) root.style.setProperty(k, v);
  // Browser UI color (address bar on phones) follows the theme style.
  const surface = getComputedStyle(root).getPropertyValue(dark ? "--color-zinc-900" : "--color-white").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface || (dark ? "#18181b" : "#ffffff"));
}

media.addEventListener("change", () => current?.theme === "system" && render());

/** Applies the appearance now, and remembers it so the next page load starts with the right colors. */
export function applyAppearance(settings: Appearance, animate = false) {
  const next: Appearance = {
    theme: settings.theme,
    lightTheme: settings.lightTheme,
    darkTheme: settings.darkTheme,
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
        lightTheme: next.lightTheme,
        darkTheme: next.darkTheme,
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
