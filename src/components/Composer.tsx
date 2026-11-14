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
import { BLOCKED_EXTENSIONS, fileExtension, formatBytes, LIMITS, type User } from "../../shared/types";
import { getDraft, setDraft as saveDraft } from "../lib/drafts";
import {
  canUseDevices,
  deviceProblem,
  formatDuration,
  prepareImage,
  prepareVideo,
  VoiceRecorder,
  type DeviceProblem,
  type PreparedImage,
  type PreparedVideo,
  type Recording,
} from "../lib/media";
import type { VoiceSettings } from "../lib/audio";
import { DeviceHelp } from "./DeviceHelp";
import type { UiMessage } from "./MessageBubble";
import { Avatar, BellOffIcon, ChartIcon, ClockIcon } from "./ui";
import {
  CameraIcon,
  EditIcon,
  FileIcon,
  ImageIcon,
  MicIcon,
  OnceIcon,
  PaperclipIcon,
  ReplyIcon,
  SendIcon,
  Spinner,
  TrashIcon,
  XIcon,
} from "./ui";

export interface ComposerHandle {
  addFile: (file: File) => void;
  focus: () => void;
}

interface Props {
  title: string;
  meId: string;
  replyTo: UiMessage | null;
  editing: UiMessage | null;
  onCancelContext: () => void;
  onSendText: (body: string, opts?: { silent?: boolean }) => void;
  /** Keeps unsent text per chat (not for secret chats). */
  draftKey?: string;
  /** Groups: people you can @mention. */
  mentionables?: User[];
  /** Opens the "New poll" dialog. */
  onCreatePoll?: () => void;
  /** Opens "Schedule message" with this text. */
  onSchedule?: (body: string) => void;
  onSaveEdit: (body: string) => void;
  onSendImage: (image: PreparedImage, caption: string, viewOnce: boolean) => void;
  onSendVideo: (video: PreparedVideo, caption: string, viewOnce: boolean) => void;
  onSendFile: (file: File) => void;
  onSendVoice: (recording: Recording) => void;
  onTyping: (isTyping: boolean) => void;
  onError: (message: string) => void;
  /** Noise suppression etc. for voice messages. */
  voice: VoiceSettings;
  /** Secret chats: text only (files would reach the server unencrypted). */
  textOnly?: boolean;
  /** Desktop: Enter sends. Off: Ctrl/Cmd+Enter sends. */
  enterToSend?: boolean;
  placeholder?: string;
}

type Pending =
  | { kind: "image"; image: PreparedImage; url: string }
  | { kind: "video"; video: PreparedVideo; url: string };

const TYPING_SEND_INTERVAL = 2500;
const TYPING_IDLE_MS = 3000;
const MAX_INPUT_HEIGHT = 160;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    title,
    meId,
    replyTo,
    editing,
    onCancelContext,
    onSendText,
    onSaveEdit,
    onSendImage,
    onSendVideo,
    onSendFile,
    onSendVoice,
    onTyping,
    onError,
    voice,
    textOnly = false,
    enterToSend = true,
    placeholder,
    draftKey,
    mentionables,
    onCreatePoll,
    onSchedule,
  },
  ref,
) {
  const [draft, setDraft] = useState(() => (draftKey ? getDraft(draftKey) : ""));
  const [sendMenu, setSendMenu] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const sendPress = useRef<number | undefined>(undefined);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [problem, setProblem] = useState<DeviceProblem | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);

  // Voice recording
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [recording, setRecording] = useState<"starting" | "on" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);

  useImperativeHandle(ref, () => ({ addFile, focus: () => inputRef.current?.focus() }));

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

  // Auto-grow up to ~6 lines; only then allow scrolling (no stray scrollbar on short messages).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.height = `${Math.min(full, MAX_INPUT_HEIGHT)}px`;
    el.style.overflowY = full > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  function stopTyping() {
    window.clearTimeout(typingTimer.current);
    if (lastTypingSent.current) {
      onTyping(false);
      lastTypingSent.current = 0;
    }
  }

  // Drafts are saved shortly after you stop typing (and survive reloads).
  useEffect(() => {
    if (!draftKey || editing) return;
    const t = window.setTimeout(() => saveDraft(draftKey, draft), 300);
    return () => window.clearTimeout(t);
  }, [draft, draftKey, editing]);

  const mentionList =
    mention && mentionables?.length
      ? mentionables
          .filter((u) => u.id !== meId)
          .filter((u) => !mention.query || u.username.toLowerCase().startsWith(mention.query.toLowerCase()) || u.displayName.toLowerCase().includes(mention.query.toLowerCase()))
          .slice(0, 6)
      : [];

  function detectMention(value: string, caret: number) {
    if (!mentionables?.length) return setMention(null);
    const m = /(^|\s)@([A-Za-z0-9_]{0,20})$/.exec(value.slice(0, caret));
    if (m) {
      setMention({ query: m[2], start: caret - m[2].length - 1 });
      setMentionIndex(0);
    } else setMention(null);
  }

  function pickMention(u: User) {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mention.start)}@${u.username} ${draft.slice(caret)}`;
    setDraft(next);
    setMention(null);
    const pos = mention.start + u.username.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  /** Ctrl/⌘+B, I, U, E, Shift+X, Shift+S wrap the selection in formatting marks. */
  function wrap(mark: string) {
    const el = inputRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = draft.slice(0, a) + mark + draft.slice(a, b) + mark + draft.slice(b);
    setDraft(next);
    requestAnimationFrame(() => el.setSelectionRange(a + mark.length, b + mark.length));
  }

  function onDraftChange(value: string, caret = value.length) {
    setDraft(value);
    detectMention(value, caret);
    if (editing) return;
    const now = Date.now();
    if (value.trim() && now - lastTypingSent.current > TYPING_SEND_INTERVAL) {
      onTyping(true);
      lastTypingSent.current = now;
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function submit(silent = false) {
    const body = draft.trim();
    if (!body || body.length > LIMITS.messageMax) return;
    if (editing) {
      if (body !== editing.body) onSaveEdit(body);
      else onCancelContext();
    } else {
      onSendText(body, silent ? { silent: true } : undefined);
      if (draftKey) saveDraft(draftKey, "");
    }
    setDraft("");
    setMention(null);
    setSendMenu(false);
    stopTyping();
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionList.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i + (e.key === "ArrowDown" ? 1 : mentionList.length - 1)) % mentionList.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionList[Math.min(mentionIndex, mentionList.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const mark = !e.shiftKey ? { b: "**", i: "*", u: "__", e: "`" }[k] : { x: "~~", s: "||" }[k];
      if (mark) {
        e.preventDefault();
        return wrap(mark);
      }
    }
    // On phones, Enter adds a new line; the send button sends.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const modifier = e.ctrlKey || e.metaKey;
    const sends = enterToSend ? !e.shiftKey && !touch : modifier;
    if (e.key === "Enter" && sends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && (replyTo || editing)) {
      e.preventDefault();
      if (editing) setDraft("");
      onCancelContext();
    }
  }

  // ---- Attachments ----

  async function addFile(file: File) {
    if (editing) return;
    if (textOnly) return onError("Secret chats are text-only, so nothing ever reaches the server unencrypted.");
    setMenuOpen(false);
    if (file.type.startsWith("image/")) {
      setPreparing(true);
      try {
        const image = await prepareImage(file);
        setPending({ kind: "image", image, url: URL.createObjectURL(image.blob) });
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setPreparing(false);
      }
    } else if (file.type.startsWith("video/")) {
      setPreparing(true);
      try {
        const video = await prepareVideo(file);
        setPending({ kind: "video", video, url: URL.createObjectURL(file) });
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setPreparing(false);
      }
    } else {
      sendDocument(file);
    }
  }

  function sendDocument(file: File) {
    setMenuOpen(false);
    if (BLOCKED_EXTENSIONS.includes(fileExtension(file.name))) {
      onError("For safety, programs and scripts can't be sent.");
      return;
    }
    if (file.size > LIMITS.uploadMaxBytes.file) {
      onError(`Files can be up to ${formatBytes(LIMITS.uploadMaxBytes.file)}.`);
      return;
    }
    if (file.size === 0) {
      onError("That file is empty.");
      return;
    }
    onSendFile(file);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = [...e.clipboardData.files][0];
    if (file) {
      e.preventDefault();
      addFile(file);
    }
  }

  // ---- Voice ----

  function startRecording() {
    const blocked = canUseDevices();
    if (blocked || !VoiceRecorder.isSupported()) {
      setProblem(blocked ?? "unsupported");
      return;
    }
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    setLevels([]);
    setElapsed(0);
    setRecording("starting");
    let last = 0;
    // Called synchronously from the tap so the browser shows its microphone prompt.
    recorder
      .start((level) => {
        const now = performance.now();
        if (now - last < 80) return; // ~12 updates/s is plenty and keeps it smooth
        last = now;
        setLevels((prev) => [...prev.slice(-39), level]);
        setElapsed(recorder.elapsed);
        if (recorder.elapsed >= LIMITS.voiceMaxSeconds) finishRecording();
      }, voice)
      .then(() => {
        if (recorderRef.current === recorder) setRecording("on");
        else recorder.cancel(); // cancelled while the prompt was open
      })
      .catch((err) => {
        recorderRef.current = null;
        setRecording(null);
        setProblem(deviceProblem(err));
      });
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecording(null);
    try {
      const rec = await recorder.stop();
      if (rec.duration < 0.7) {
        onError("Hold on — that was too short to send.");
        return;
      }
      if (rec.blob.size > LIMITS.uploadMaxBytes.voice) {
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
    setRecording(null);
  }

  const tooLong = draft.length > LIMITS.messageMax;
  const context = editing ?? replyTo;
  const contextText = !context
    ? ""
    : context.kind === "voice"
      ? "🎤 Voice message"
      : context.kind === "image"
        ? context.meta?.viewOnce
          ? "📷 View-once photo"
          : `📷 ${context.body || "Photo"}`
        : context.kind === "video"
          ? `🎥 ${context.body || "Video"}`
          : context.kind === "file"
            ? `📄 ${context.meta?.name ?? "Document"}`
            : context.body;

  return (
    <div
      className="divider-t relative bg-white/90 px-2.5 py-2.5 backdrop-blur-md sm:px-3 md:px-4 dark:bg-zinc-900/90"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-3xl">
        {context && (
          <div className="fade-in mb-2 flex items-center gap-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            {editing ? (
              <EditIcon className="size-4 shrink-0 text-accent-fg" />
            ) : (
              <ReplyIcon className="size-4 shrink-0 text-accent-fg" />
            )}
            <div className="min-w-0 flex-1 border-l-2 border-accent pl-2.5">
              <p className="text-xs font-semibold text-accent-fg">
                {editing ? "Editing message" : `Replying to ${context.userId === meId ? "yourself" : context.displayName}`}
              </p>
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">{contextText}</p>
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
              {recording === "starting" ? (
                <>
                  <Spinner className="size-4 text-zinc-400" />
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">Allow the microphone to start recording…</span>
                </>
              ) : (
                <>
                  <span className="record-pulse size-2.5 shrink-0 rounded-full bg-red-500" />
                  <span className="w-10 shrink-0 text-sm font-medium tabular-nums">{formatDuration(elapsed)}</span>
                  <div className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden="true">
                    {levels.map((l, i) => (
                      <span key={i} className="w-[3px] shrink-0 rounded-full bg-accent" style={{ height: `${Math.max(12, l * 100)}%` }} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={finishRecording}
              disabled={recording !== "on"}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition hover:opacity-90 active:scale-95 disabled:opacity-40"
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
            {!editing && !textOnly && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={preparing}
                  aria-expanded={menuOpen}
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full transition hover:bg-zinc-100 hover:text-accent-fg disabled:opacity-50 dark:hover:bg-zinc-800 ${
                    menuOpen ? "bg-zinc-100 text-accent-fg dark:bg-zinc-800" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                  aria-label="Attach"
                  title="Attach"
                >
                  {preparing ? <Spinner className="size-5" /> : <PaperclipIcon className="size-5" />}
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="pop-in absolute bottom-14 left-0 z-40 w-56 overflow-hidden rounded-2xl bg-white py-1.5 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10" role="menu">
                      <AttachItem icon={<ImageIcon className="size-5" />} color="bg-violet-500" label="Photos & videos" onClick={() => mediaInputRef.current?.click()} />
                      <AttachItem icon={<CameraIcon className="size-5" />} color="bg-rose-500" label="Camera" onClick={() => cameraInputRef.current?.click()} />
                      <AttachItem icon={<FileIcon className="size-5" />} color="bg-sky-500" label="Document" onClick={() => docInputRef.current?.click()} />
                      {onCreatePoll && (
                        <AttachItem
                          icon={<ChartIcon className="size-5" />}
                          color="bg-amber-500"
                          label="Poll"
                          onClick={() => {
                            setMenuOpen(false);
                            onCreatePoll();
                          }}
                        />
                      )}
                    </div>
                  </>
                )}
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) addFile(file);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) addFile(file);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={docInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) sendDocument(file);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <div className="relative flex-1">
              {mentionList.length > 0 && (
                <ul className="pop-in absolute right-0 bottom-full left-0 z-40 mb-2 overflow-hidden rounded-2xl bg-white p-1 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10" role="listbox" aria-label="Mention someone">
                  {mentionList.map((u, i) => (
                    <li key={u.id} role="option" aria-selected={i === mentionIndex}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickMention(u)}
                        onMouseMove={() => setMentionIndex(i)}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left ${i === mentionIndex ? "bg-accent/10 dark:bg-accent/20" : ""}`}
                      >
                        <Avatar name={u.displayName} seed={u.id} user={u} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.displayName}</span>
                        <span className="shrink-0 truncate text-xs text-zinc-500 dark:text-zinc-400">@{u.username}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
                onSelect={(e) => mention && detectMention(e.currentTarget.value, e.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={stopTyping}
                rows={1}
                placeholder={editing ? "Edit message" : (placeholder ?? "Message")}
                aria-label="Message"
                enterKeyHint="send"
                className={`msg-text no-scrollbar block w-full resize-none overflow-hidden rounded-[1.375rem] border bg-zinc-50 px-4 py-2.5 leading-6 placeholder:truncate outline-none transition placeholder:text-zinc-400 focus:bg-white focus:ring-4 dark:bg-zinc-800 dark:focus:bg-zinc-800 ${
                  tooLong
                    ? "border-red-400 focus:ring-red-500/15"
                    : "border-zinc-200 focus:border-accent focus:ring-accent/15 dark:border-zinc-700"
                }`}
              />
              {draft.length > LIMITS.messageMax - 200 && (
                <span className={`absolute -top-5 right-3 text-xs tabular-nums ${tooLong ? "text-red-500" : "text-zinc-400"}`}>
                  {draft.length}/{LIMITS.messageMax}
                </span>
              )}
            </div>
            {draft.trim() || editing || textOnly ? (
              <div className="relative">
                <button
                  type="submit"
                  disabled={!draft.trim() || tooLong}
                  // Right-click or long-press: "Send without sound" (like Telegram).
                  onContextMenu={(e) => {
                    if (editing || !draft.trim()) return;
                    e.preventDefault();
                    setSendMenu(true);
                  }}
                  onTouchStart={() => {
                    if (editing || !draft.trim()) return;
                    sendPress.current = window.setTimeout(() => {
                      navigator.vibrate?.(10);
                      setSendMenu(true);
                    }, 450);
                  }}
                  onTouchEnd={(e) => {
                    window.clearTimeout(sendPress.current);
                    if (sendMenu) e.preventDefault();
                  }}
                  onTouchMove={() => window.clearTimeout(sendPress.current)}
                  className="pop-in flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={editing ? "Save edit" : "Send message"}
                  title={editing ? undefined : "Send (right-click for more)"}
                >
                  <SendIcon className="size-5 -translate-x-px translate-y-px" />
                </button>
                {sendMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setSendMenu(false)} />
                    <div className="pop-in absolute right-0 bottom-14 z-40 w-56 overflow-hidden rounded-2xl bg-white p-1 shadow-xl ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-white/10" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => submit(true)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60"
                      >
                        <BellOffIcon className="size-5 text-zinc-500" />
                        Send without sound
                      </button>
                      {onSchedule && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            const body = draft.trim();
                            if (!body || body.length > LIMITS.messageMax) return;
                            onSchedule(body);
                            setDraft("");
                            if (draftKey) saveDraft(draftKey, "");
                            setSendMenu(false);
                            stopTyping();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60"
                        >
                          <ClockIcon className="size-5 text-zinc-500" />
                          Schedule message
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                className="pop-in flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition hover:opacity-90 active:scale-95"
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
        <MediaPreview
          pending={pending}
          title={title}
          onCancel={() => {
            URL.revokeObjectURL(pending.url);
            setPending(null);
          }}
          onSend={(caption, viewOnce) => {
            if (pending.kind === "image") onSendImage(pending.image, caption, viewOnce);
            else onSendVideo(pending.video, caption, viewOnce);
            if (pending.kind === "video") URL.revokeObjectURL(pending.url);
            setPending(null);
          }}
        />
      )}

      {problem && (
        <DeviceHelp
          problem={problem}
          device="microphone"
          onClose={() => setProblem(null)}
          onRetry={() => {
            setProblem(null);
            startRecording();
          }}
        />
      )}
    </div>
  );
});

function AttachItem({ icon, color, label, onClick }: { icon: React.ReactNode; color: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-700/60"
    >
      <span className={`flex size-9 items-center justify-center rounded-full text-white ${color}`}>{icon}</span>
      {label}
    </button>
  );
}

function MediaPreview({
  pending,
  title,
  onCancel,
  onSend,
}: {
  pending: Pending;
  title: string;
  onCancel: () => void;
  onSend: (caption: string, viewOnce: boolean) => void;
}) {
  const [caption, setCaption] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const isImage = pending.kind === "image";

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fade-in fixed inset-0 z-50 flex flex-col bg-zinc-950" role="dialog" aria-modal="true" aria-label={isImage ? "Send photo" : "Send video"}>
      <div className="flex items-center justify-between p-3 text-white">
        <button onClick={onCancel} className="rounded-full bg-white/10 p-2 hover:bg-white/20" aria-label="Cancel">
          <XIcon className="size-5" />
        </button>
        <span className="text-sm text-white/80">
          Send to {title}
          {pending.kind === "video" && ` · ${formatBytes(pending.video.blob.size)}`}
        </span>
        <span className="size-9" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {isImage ? (
          <img src={pending.url} alt="Preview" className={`pop-in max-h-full max-w-full rounded-lg object-contain transition ${viewOnce ? "blur-sm" : ""}`} />
        ) : (
          <video src={pending.url} controls playsInline className={`pop-in max-h-full max-w-full rounded-lg transition ${viewOnce ? "blur-sm" : ""}`} />
        )}
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
            viewOnce ? "bg-accent text-accent-ink" : "bg-white/10 text-white hover:bg-white/20"
          }`}
          title="View once: they can open it one time, then it's gone"
        >
          <OnceIcon className="size-5" />
          {viewOnce ? "View once" : "Keep"}
        </button>
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={viewOnce ? `View-once ${isImage ? "photos" : "videos"} can't have captions` : "Add a caption…"}
          disabled={viewOnce}
          maxLength={LIMITS.messageMax}
          autoFocus
          className="h-11 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-sm text-white outline-none placeholder:text-white/50 focus:bg-white/15 disabled:opacity-50"
        />
        <button
          type="submit"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm transition hover:opacity-90 active:scale-95"
          aria-label={isImage ? "Send photo" : "Send video"}
        >
          <SendIcon className="size-5 -translate-x-px translate-y-px" />
        </button>
      </form>
    </div>
  );
}
