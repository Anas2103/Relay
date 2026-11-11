import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { LIMITS } from "../../shared/types";
import { formatDuration, prepareImage, VoiceRecorder, type PreparedImage, type Recording } from "../lib/media";
import type { UiMessage } from "./MessageBubble";
import { EditIcon, ImageIcon, MicIcon, OnceIcon, ReplyIcon, SendIcon, Spinner, TrashIcon, XIcon } from "./ui";

export interface ComposerHandle {
  addImage: (file: File) => void;
  focus: () => void;
}

interface Props {
  title: string;
  meId: string;
  connected: boolean;
  replyTo: UiMessage | null;
  editing: UiMessage | null;
  onCancelContext: () => void;
  onSendText: (body: string) => void;
  onSaveEdit: (body: string) => void;
  onSendImage: (image: PreparedImage, caption: string, viewOnce: boolean) => void;
  onSendVoice: (recording: Recording) => void;
  onTyping: (isTyping: boolean) => void;
  onError: (message: string) => void;
}

const TYPING_SEND_INTERVAL = 2500;
const TYPING_IDLE_MS = 3000;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { title, meId, connected, replyTo, editing, onCancelContext, onSendText, onSaveEdit, onSendImage, onSendVoice, onTyping, onError },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState<{ image: PreparedImage; url: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);

  // Voice recording
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  useImperativeHandle(ref, () => ({ addImage, focus: () => inputRef.current?.focus() }));

  // Load the message into the box when editing starts.
  useEffect(() => {
    if (editing) {
      setDraft(editing.body);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Auto-grow the textarea up to ~6 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  function stopTyping() {
    window.clearTimeout(typingTimer.current);
    if (lastTypingSent.current) {
      onTyping(false);
      lastTypingSent.current = 0;
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (editing) return;
    const now = Date.now();
    if (value.trim() && now - lastTypingSent.current > TYPING_SEND_INTERVAL) {
      onTyping(true);
      lastTypingSent.current = now;
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function submit() {
    const body = draft.trim();
    if (!body || body.length > LIMITS.messageMax) return;
    if (editing) {
      if (body !== editing.body) onSaveEdit(body);
      else onCancelContext();
    } else {
      onSendText(body);
    }
    setDraft("");
    stopTyping();
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && (replyTo || editing)) {
      e.preventDefault();
      if (editing) setDraft("");
      onCancelContext();
    }
  }

  // ---- Photos ----

  async function addImage(file: File) {
    if (editing) return;
    setPreparing(true);
    try {
      const image = await prepareImage(file);
      setPending({ image, url: URL.createObjectURL(image.blob) });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      addImage(file);
    }
  }

  // ---- Voice ----

  async function startRecording() {
    if (!VoiceRecorder.isSupported()) {
      onError("Voice messages aren't supported in this browser.");
      return;
    }
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    setLevels([]);
    setElapsed(0);
    try {
      let last = 0;
      await recorder.start((level) => {
        const now = performance.now();
        if (now - last < 80) return; // ~12 updates/s is plenty and keeps it smooth
        last = now;
        setLevels((prev) => [...prev.slice(-39), level]);
        setElapsed(recorder.elapsed);
        if (recorder.elapsed >= LIMITS.voiceMaxSeconds) finishRecording();
      });
      setRecording(true);
    } catch (err) {
      recorderRef.current = null;
      const denied = (err as DOMException).name === "NotAllowedError";
      onError(denied ? "Microphone access was blocked. Allow it in your browser settings." : "Couldn't start the microphone.");
    }
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecording(false);
    try {
      const rec = await recorder.stop();
      if (rec.duration < 0.7) {
        onError("Hold on — that was too short to send.");
        return;
      }
      if (rec.blob.size > LIMITS.mediaMaxBytes) {
        onError("That recording is too long.");
        return;
      }
      onSendVoice(rec);
    } catch {
      onError("Couldn't save the recording.");
    }
  }

  function cancelRecording() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
  }

  const tooLong = draft.length > LIMITS.messageMax;
  const context = editing ?? replyTo;

  return (
    <div className="border-t border-zinc-200 bg-white px-3 py-2.5 md:px-6 dark:border-zinc-800 dark:bg-zinc-900" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto max-w-3xl">
        {context && (
          <div className="fade-in mb-2 flex items-center gap-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            {editing ? <EditIcon className="size-4 shrink-0 text-bubble-fg" /> : <ReplyIcon className="size-4 shrink-0 text-bubble-fg" />}
            <div className="min-w-0 flex-1 border-l-2 border-bubble pl-2.5">
              <p className="text-xs font-semibold text-bubble-fg">
                {editing ? "Editing message" : `Replying to ${context.userId === meId ? "yourself" : context.displayName}`}
              </p>
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">
                {context.kind === "voice" ? "🎤 Voice message" : context.kind === "image" ? context.meta?.viewOnce ? "📷 View-once photo" : `📷 ${context.body || "Photo"}` : context.body}
              </p>
            </div>
            <button
              onClick={() => {
                if (editing) setDraft("");
                onCancelContext();
              }}
              className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              aria-label="Cancel"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        )}

        {recording ? (
          <div className="fade-in flex items-center gap-3">
            <button
              onClick={cancelRecording}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label="Discard recording"
            >
              <TrashIcon className="size-5" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
              <span className="record-pulse size-2.5 shrink-0 rounded-full bg-red-500" />
              <span className="w-10 shrink-0 text-sm font-medium tabular-nums">{formatDuration(elapsed)}</span>
              <div className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden="true">
                {levels.map((l, i) => (
                  <span key={i} className="w-[3px] shrink-0 rounded-full bg-bubble" style={{ height: `${Math.max(12, l * 100)}%` }} />
                ))}
              </div>
            </div>
            <button
              onClick={finishRecording}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bubble text-white shadow-sm transition hover:opacity-90 active:scale-95"
              aria-label="Send voice message"
            >
              <SendIcon className="size-5 -translate-x-px translate-y-px" />
            </button>
          </div>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {!editing && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) addImage(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={preparing}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-bubble-fg disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  aria-label="Send a photo"
                  title="Send a photo"
                >
                  {preparing ? <Spinner className="size-5" /> : <ImageIcon className="size-5" />}
                </button>
              </>
            )}
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={stopTyping}
                rows={1}
                placeholder={editing ? "Edit message" : `Message ${title}`}
                aria-label="Message"
                enterKeyHint="send"
                className={`block w-full resize-none rounded-2xl border bg-zinc-50 px-4 py-2.5 text-[15px] leading-6 outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-4 dark:bg-zinc-800 dark:focus:bg-zinc-800 ${
                  tooLong
                    ? "border-red-400 focus:ring-red-500/15"
                    : "border-zinc-200 focus:border-bubble focus:ring-bubble/15 dark:border-zinc-700"
                }`}
              />
              {draft.length > LIMITS.messageMax - 200 && (
                <span className={`absolute -top-5 right-3 text-xs tabular-nums ${tooLong ? "text-red-500" : "text-zinc-400"}`}>
                  {draft.length}/{LIMITS.messageMax}
                </span>
              )}
            </div>
            {draft.trim() || editing ? (
              <button
                type="submit"
                disabled={!draft.trim() || tooLong}
                className="pop-in flex size-11 shrink-0 items-center justify-center rounded-full bg-bubble text-white shadow-sm transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={editing ? "Save edit" : "Send message"}
              >
                <SendIcon className="size-5 -translate-x-px translate-y-px" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={!connected}
                className="pop-in flex size-11 shrink-0 items-center justify-center rounded-full bg-bubble text-white shadow-sm transition hover:opacity-90 active:scale-95 disabled:opacity-40"
                aria-label="Record a voice message"
                title="Record a voice message"
              >
                <MicIcon className="size-5" />
              </button>
            )}
          </form>
        )}
      </div>

      {pending && (
        <PhotoPreview
          url={pending.url}
          title={title}
          onCancel={() => {
            URL.revokeObjectURL(pending.url);
            setPending(null);
          }}
          onSend={(caption, viewOnce) => {
            onSendImage(pending.image, caption, viewOnce);
            setPending(null); // the URL is reused by the optimistic message
          }}
        />
      )}
    </div>
  );
});

function PhotoPreview({
  url,
  title,
  onCancel,
  onSend,
}: {
  url: string;
  title: string;
  onCancel: () => void;
  onSend: (caption: string, viewOnce: boolean) => void;
}) {
  const [caption, setCaption] = useState("");
  const [viewOnce, setViewOnce] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-zinc-950/95" role="dialog" aria-modal="true" aria-label="Send photo">
      <div className="flex items-center justify-between p-3 text-white">
        <button onClick={onCancel} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Cancel">
          <XIcon className="size-5" />
        </button>
        <span className="text-sm text-white/80">Send to {title}</span>
        <span className="size-9" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img src={url} alt="Preview" className={`pop-in max-h-full max-w-full rounded-lg object-contain transition ${viewOnce ? "blur-sm" : ""}`} />
      </div>
      <form
        className="mx-auto flex w-full max-w-2xl items-end gap-2 p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        onSubmit={(e) => {
          e.preventDefault();
          onSend(caption.trim(), viewOnce);
        }}
      >
        <button
          type="button"
          onClick={() => setViewOnce((v) => !v)}
          aria-pressed={viewOnce}
          className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition ${
            viewOnce ? "bg-bubble text-white" : "bg-white/10 text-white hover:bg-white/20"
          }`}
          title="View once: they can open it one time, then it's gone"
        >
          <OnceIcon className="size-5" />
          {viewOnce ? "View once" : "Keep"}
        </button>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={viewOnce ? "View-once photos can't have captions" : "Add a caption…"}
          disabled={viewOnce}
          maxLength={LIMITS.messageMax}
          autoFocus
          className="h-11 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-sm text-white outline-none placeholder:text-white/50 focus:bg-white/15 disabled:opacity-50"
        />
        <button
          type="submit"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bubble text-white shadow-sm transition hover:opacity-90 active:scale-95"
          aria-label="Send photo"
        >
          <SendIcon className="size-5 -translate-x-px translate-y-px" />
        </button>
      </form>
    </div>
  );
}
