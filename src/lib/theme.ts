import { BUBBLE_COLORS, type BubbleColor, type Settings, type Theme } from "../../shared/types";

const STORAGE_KEY = "relay:appearance";
const media = window.matchMedia("(prefers-color-scheme: dark)");
let current: { theme: Theme; bubbleColor: BubbleColor } = { theme: "system", bubbleColor: "indigo" };

function render() {
  const dark = current.theme === "dark" || (current.theme === "system" && media.matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.setProperty("--bubble", BUBBLE_COLORS[current.bubbleColor] ?? BUBBLE_COLORS.indigo);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#09090b" : "#ffffff");
}

media.addEventListener("change", () => current.theme === "system" && render());

/** Applies theme + bubble color now, and remembers them so the next load has no flash. */
export function applyAppearance(settings: Pick<Settings, "theme" | "bubbleColor">, animate = false) {
  if (current.theme === settings.theme && current.bubbleColor === settings.bubbleColor) return;
  current = { theme: settings.theme, bubbleColor: settings.bubbleColor };
  if (animate) {
    document.documentElement.classList.add("theme-transition");
    window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 250);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage unavailable (private mode) — fine
  }
  render();
}
