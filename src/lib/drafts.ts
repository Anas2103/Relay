import { useSyncExternalStore } from "react";

/**
 * Unsent messages per chat (like Telegram's drafts), kept in this browser only.
 * Secret chats never get a draft: their text would sit unencrypted on disk.
 */
const KEY = "relay:drafts:v1";
const listeners = new Set<() => void>();
let cache: Record<string, string> = load();

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getDraft(roomId: string): string {
  return cache[roomId] ?? "";
}

export function setDraft(roomId: string, text: string): void {
  const value = text.trim() ? text.slice(0, 4000) : "";
  if ((cache[roomId] ?? "") === value) return;
  const next = { ...cache };
  if (value) next[roomId] = value;
  else delete next[roomId];
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: the draft lives until reload
  }
  for (const l of listeners) l();
}

export function clearAllDrafts(): void {
  cache = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDrafts(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => cache);
}
