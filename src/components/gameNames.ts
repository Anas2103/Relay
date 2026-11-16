import { createContext, useContext } from "react";

/** userId → display name ("You" for yourself), provided by the chat to its game cards. */
export const GameNames = createContext<Record<string, string>>({});

/** Display name for a player (or "Someone" for a person who left). */
export function useGameName() {
  const names = useContext(GameNames);
  return (id: string | null | undefined) => (id ? (names[id] ?? "Someone") : "Someone");
}
