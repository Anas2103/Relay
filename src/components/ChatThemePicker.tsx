import { useState } from "react";
import { CHAT_THEMES, type ChatThemeId } from "../../shared/chatThemes";
import type { Room } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { themeSwatch } from "../lib/chatTheme";
import { currentlyDark } from "../lib/theme";
import { Sheet } from "./Dialogs";
import { CheckIcon, Spinner } from "./ui";

/** Pick a theme for one chat. Everyone in the chat sees the change. */
export function ChatThemePicker({ room, onSaved, onClose }: { room: Room; onSaved: (room: Room) => void; onClose: () => void }) {
  const [busy, setBusy] = useState<ChatThemeId | "none" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = currentlyDark();

  const pick = async (theme: ChatThemeId | null) => {
    if (theme === room.theme || busy) return;
    setBusy(theme ?? "none");
    setError(null);
    try {
      const { room: saved } = await api.updateRoom(room.id, { theme });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change the theme.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Chat theme" onClose={onClose} wide>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {room.type === "group" ? "Everyone in this group" : "You both"} will see the theme you pick.
      </p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Chat theme">
        <ThemeTile
          label="Default"
          hint="Everyone's own look"
          selected={room.theme === null}
          busy={busy === "none"}
          wall={dark ? "#18181b" : "#f4f4f5"}
          bubble="var(--bubble-bg, var(--bubble))"
          ink="var(--bubble-ink)"
          onClick={() => pick(null)}
        />
        {(Object.keys(CHAT_THEMES) as ChatThemeId[]).map((id) => {
          const s = themeSwatch(id, dark);
          return (
            <ThemeTile
              key={id}
              label={CHAT_THEMES[id].label}
              selected={room.theme === id}
              busy={busy === id}
              wall={s.wall}
              bubble={s.bubble}
              ink={s.ink}
              onClick={() => pick(id)}
            />
          );
        })}
      </div>
    </Sheet>
  );
}

function ThemeTile(props: { label: string; hint?: string; selected: boolean; busy: boolean; wall: string; bubble: string; ink: string; onClick: () => void }) {
  return (
    <button role="radio" aria-checked={props.selected} aria-label={props.label} onClick={props.onClick} className="group flex flex-col items-center gap-1.5 text-center">
      <span
        className={`relative flex aspect-[3/4] w-full flex-col justify-end gap-1 overflow-hidden rounded-2xl p-2 ring-2 transition ${
          props.selected ? "ring-accent" : "ring-zinc-200 group-hover:ring-zinc-300 dark:ring-zinc-800 dark:group-hover:ring-zinc-700"
        }`}
        style={{ background: props.wall }}
      >
        <span className="h-3 w-3/5 rounded-full bg-zinc-300/80 dark:bg-zinc-700/80" />
        <span className="ml-auto h-3 w-3/4 rounded-full" style={{ background: props.bubble }} />
        <span className="ml-auto h-3 w-1/2 rounded-full" style={{ background: props.bubble }} />
        {(props.selected || props.busy) && (
          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink">
            {props.busy ? <Spinner className="size-3" /> : <CheckIcon className="size-3.5" />}
          </span>
        )}
      </span>
      <span className="text-xs font-medium">{props.label}</span>
      {props.hint && <span className="-mt-1 text-[11px] text-zinc-500">{props.hint}</span>}
    </button>
  );
}
