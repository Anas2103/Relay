import type { CSSProperties } from "react";
import { CHAT_THEMES, themeBubble, type ChatThemeId } from "../../shared/chatThemes";

/**
 * CSS variables that put a chat theme on one chat (see `.ctheme` in index.css).
 * They override the app-wide appearance only inside that chat.
 */
export function chatThemeStyle(id: ChatThemeId): CSSProperties {
  const t = CHAT_THEMES[id];
  return {
    "--ct-light-1": t.wall.light[0],
    "--ct-light-2": t.wall.light[1],
    "--ct-dark-1": t.wall.dark[0],
    "--ct-dark-2": t.wall.dark[1],
    "--ct-accent": t.accent,
    "--bubble-bg": themeBubble(t),
    "--bubble": t.bubble[t.bubble.length - 1],
    "--bubble-ink": t.ink,
  } as CSSProperties;
}

/** Small preview swatch: the theme's background with its bubble color on top. */
export function themeSwatch(id: ChatThemeId, dark: boolean): { wall: string; bubble: string; ink: string } {
  const t = CHAT_THEMES[id];
  const [a, b] = dark ? t.wall.dark : t.wall.light;
  return { wall: `linear-gradient(180deg, ${a}, ${b})`, bubble: themeBubble(t), ink: t.ink };
}
