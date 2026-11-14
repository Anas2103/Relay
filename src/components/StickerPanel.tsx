import { useEffect, useRef, useState } from "react";
import type { Sticker } from "../../shared/types";
import { api } from "../lib/api";
import { prepareSticker } from "../lib/media";
import { PlusIcon, Spinner, XIcon } from "./ui";

/** Your stickers, shared by every chat (and kept fresh across opens). */
let cache: Sticker[] | null = null;
const listeners = new Set<() => void>();
const setCache = (next: Sticker[]) => {
  cache = next;
  listeners.forEach((fn) => fn());
};

export const stickerUrl = (id: string) => `/api/stickers/${id}`;

/** Adds an image (a photo from a chat, or a file) to your stickers. */
export async function addToStickers(source: Blob): Promise<Sticker> {
  const prepared = await prepareSticker(source);
  const { sticker } = await api.addSticker(prepared.blob, prepared.width, prepared.height);
  setCache([sticker, ...(cache ?? [])]);
  return sticker;
}

export function StickerPanel({ onPick, onClose }: { onPick: (sticker: Sticker) => void; onClose: () => void }) {
  const [stickers, setStickers] = useState<Sticker[] | null>(cache);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setStickers(cache);
    listeners.add(sync);
    api.stickers().then(
      (r) => setCache(r.stickers),
      () => setStickers((s) => s ?? []),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files).slice(0, 10)) await addToStickers(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that sticker.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setCache((cache ?? []).filter((s) => s.id !== id));
    await api.removeSticker(id).catch(() => api.stickers().then((r) => setCache(r.stickers)));
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Stickers"
        className="pop-in absolute right-0 bottom-full z-40 mb-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-700">
          <span className="text-sm font-semibold">Your stickers</span>
          {!!stickers?.length && (
            <button onClick={() => setEditing((e) => !e)} className="rounded-lg px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent/10">
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
        <div className="grid max-h-72 grid-cols-4 gap-1 overflow-y-auto p-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 text-xs text-zinc-500 transition hover:border-accent hover:text-accent-fg disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400"
            aria-label="Add stickers from your photos"
          >
            {busy ? <Spinner className="size-5" /> : <PlusIcon className="size-5" />}
            Add
          </button>
          {stickers === null ? (
            <div className="col-span-3 flex items-center justify-center text-zinc-400">
              <Spinner className="size-5" />
            </div>
          ) : (
            stickers.map((s) => (
              <div key={s.id} className="relative">
                <button
                  onClick={() => (editing ? void remove(s.id) : onPick(s))}
                  className={`flex aspect-square w-full items-center justify-center rounded-xl p-1 transition hover:bg-zinc-100 active:scale-95 dark:hover:bg-zinc-700 ${editing ? "animate-pulse" : ""}`}
                  aria-label={editing ? "Remove sticker" : "Send sticker"}
                >
                  <img src={stickerUrl(s.id)} alt="" loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" />
                </button>
                {editing && (
                  <span className="pointer-events-none absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-red-600 text-white shadow">
                    <XIcon className="size-3" />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        {stickers?.length === 0 && !busy && (
          <p className="px-4 pb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Add pictures from your device, or long-press any photo in a chat → “Add to stickers”. Cut-out PNGs look best.
          </p>
        )}
        {error && <p className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
      </div>
    </>
  );
}
