import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LIMITS, PALETTE, WALLPAPERS, type ColorName, type Me, type Settings, type Theme, type Wallpaper } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { prepareAvatar } from "../lib/media";
import { playMessageSound } from "../lib/sound";
import { AlertIcon, Avatar, CameraIcon, CheckIcon, MonitorIcon, MoonIcon, SendIcon, Spinner, SunIcon, XIcon } from "./ui";

type Tab = "profile" | "appearance" | "notifications" | "security";

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 " +
  "dark:border-zinc-700 dark:bg-zinc-800";

const primaryButton =
  "flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink " +
  "shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type Status = { kind: "error" | "success"; text: string } | null;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

export function SettingsDialog({
  me,
  onClose,
  onMeUpdated,
}: {
  me: Me;
  onClose: () => void;
  onMeUpdated: (me: Me) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("profile");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const tabs: [Tab, string][] = [
    ["profile", "Profile"],
    ["appearance", "Appearance"],
    ["notifications", "Notifications"],
    ["security", "Password"],
  ];

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100"
      aria-labelledby="settings-title"
    >
      <div className="flex max-h-[88dvh] flex-col">
        <div className="flex items-center justify-between px-5 pt-5 md:px-6">
          <h2 id="settings-title" className="text-lg font-semibold">
            Settings
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 md:px-5 dark:border-zinc-800" aria-label="Settings sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`shrink-0 border-b-2 px-2.5 pb-2.5 text-sm font-medium transition ${
                tab === id
                  ? "border-accent text-zinc-900 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="overflow-y-auto p-5 md:p-6">
          {tab === "profile" && <ProfileTab me={me} onMeUpdated={onMeUpdated} />}
          {tab === "appearance" && <AppearanceTab me={me} onMeUpdated={onMeUpdated} />}
          {tab === "notifications" && <NotificationsTab me={me} onMeUpdated={onMeUpdated} />}
          {tab === "security" && <PasswordTab />}
        </div>
      </div>
    </dialog>
  );
}

// ---------- Profile ----------

function ProfileTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [busy, setBusy] = useState<"save" | "avatar" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changed = (displayName.trim() !== me.displayName && displayName.trim() !== "") || bio.trim() !== me.bio;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setStatus(null);
    try {
      const { user } = await api.account.update({ displayName, bio });
      onMeUpdated(user);
      setDisplayName(user.displayName);
      setBio(user.bio);
      setStatus({ kind: "success", text: "Profile saved." });
    } catch (err) {
      setStatus({ kind: "error", text: errText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function changePicture(file: File) {
    setBusy("avatar");
    setStatus(null);
    try {
      const { user } = await api.account.uploadAvatar(await prepareAvatar(file));
      onMeUpdated(user);
      setStatus({ kind: "success", text: "Profile picture updated." });
    } catch (err) {
      setStatus({ kind: "error", text: errText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function removePicture() {
    setBusy("avatar");
    try {
      const { user } = await api.account.removeAvatar();
      onMeUpdated(user);
    } catch (err) {
      setStatus({ kind: "error", text: errText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative rounded-full"
          aria-label="Change profile picture"
          disabled={busy !== null}
        >
          <Avatar name={me.displayName} seed={me.id} user={me} size="xl" />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            {busy === "avatar" ? <Spinner className="size-6" /> : <CameraIcon className="size-6" />}
          </span>
        </button>
        <div className="space-y-2">
          <p className="font-medium">{me.displayName}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">@{me.username}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="rounded-lg px-2.5 py-1 text-sm font-medium text-accent-fg ring-1 ring-accent/30 transition hover:bg-accent/10 disabled:opacity-50"
            >
              {me.avatarVersion ? "Change photo" : "Add photo"}
            </button>
            {me.avatarVersion && (
              <button
                type="button"
                onClick={removePicture}
                disabled={busy !== null}
                className="rounded-lg px-2.5 py-1 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) changePicture(file);
            e.target.value = "";
          }}
        />
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Display name</span>
        <input
          className={inputClass}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={LIMITS.displayNameMax}
          autoComplete="nickname"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-medium">
          Bio
          <span className="font-normal text-zinc-400 tabular-nums">
            {bio.length}/{LIMITS.bioMax}
          </span>
        </span>
        <textarea
          className={`${inputClass} resize-none`}
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={LIMITS.bioMax}
          placeholder="A few words about you"
        />
      </label>
      <StatusLine status={status} />
      <div className="flex justify-end">
        <button type="submit" disabled={!changed || busy !== null} className={primaryButton}>
          {busy === "save" && <Spinner />}
          Save profile
        </button>
      </div>
    </form>
  );
}

// ---------- Appearance ----------

function useSettingSaver(me: Me, onMeUpdated: (me: Me) => void) {
  const [error, setError] = useState<string | null>(null);
  async function save(patch: Partial<Settings>) {
    const previous = me;
    // Apply instantly, then confirm with the server.
    onMeUpdated({ ...me, settings: { ...me.settings, ...patch } });
    setError(null);
    try {
      const { user } = await api.account.update({ settings: patch });
      onMeUpdated(user);
    } catch (err) {
      onMeUpdated(previous);
      setError(errText(err));
    }
  }
  return { save, error };
}

function AppearanceTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const s = me.settings;
  const themes: [Theme, string, ReactNode][] = [
    ["system", "System", <MonitorIcon key="s" className="size-5" />],
    ["light", "Light", <SunIcon key="l" className="size-5" />],
    ["dark", "Dark", <MoonIcon key="d" className="size-5" />],
  ];

  return (
    <div className="space-y-6">
      <AppearancePreview me={me} />

      <section>
        <h3 className="text-sm font-semibold">Theme</h3>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {themes.map(([value, label, icon]) => (
            <button
              key={value}
              role="radio"
              aria-checked={s.theme === value}
              onClick={() => save({ theme: value })}
              className={`flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium ring-1 transition ${
                s.theme === value
                  ? "bg-accent/10 text-accent-fg ring-2 ring-accent"
                  : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">App color</h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Buttons, links, badges and highlights.</p>
        <Swatches label="App color" value={s.accentColor} onPick={(c) => save({ accentColor: c })} />
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Bubble color</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Only your own messages.</p>
          </div>
          {s.bubbleColor !== s.accentColor && (
            <button
              onClick={() => save({ bubbleColor: s.accentColor })}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent/10"
            >
              Match app color
            </button>
          )}
        </div>
        <Swatches label="Bubble color" value={s.bubbleColor} onPick={(c) => save({ bubbleColor: c })} />
      </section>

      <section>
        <h3 className="text-sm font-semibold">Chat wallpaper</h3>
        <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Chat wallpaper">
          {(Object.entries(WALLPAPERS) as [Wallpaper, string][]).map(([name, label]) => (
            <button
              key={name}
              role="radio"
              aria-checked={s.wallpaper === name}
              onClick={() => save({ wallpaper: name })}
              className="group flex flex-col items-center gap-1.5"
            >
              <span
                className={`chat-wall wall-${name} relative flex h-16 w-full items-end justify-end overflow-hidden rounded-xl p-1.5 ring-1 transition group-hover:scale-[1.03] ${
                  s.wallpaper === name ? "ring-2 ring-accent" : "ring-zinc-200 dark:ring-zinc-700"
                }`}
              >
                <span className="h-2.5 w-7 rounded-full bg-bubble" />
                {s.wallpaper === name && (
                  <span className="absolute top-1.5 left-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </span>
              <span className={`text-xs ${s.wallpaper === name ? "font-semibold text-accent-fg" : "text-zinc-500 dark:text-zinc-400"}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {error && <StatusLine status={{ kind: "error", text: error }} />}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Your appearance syncs across all your devices.</p>
    </div>
  );
}

function Swatches({ label, value, onPick }: { label: string; value: ColorName; onPick: (c: ColorName) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label={label}>
      {(Object.entries(PALETTE) as [ColorName, (typeof PALETTE)[ColorName]][]).map(([name, c]) => (
        <button
          key={name}
          role="radio"
          aria-checked={value === name}
          aria-label={c.label}
          title={c.label}
          onClick={() => onPick(name)}
          className={`flex size-9 items-center justify-center rounded-full transition hover:scale-110 ${
            value === name ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900" : ""
          }`}
          style={{ backgroundColor: c.hex, ["--tw-ring-color" as string]: c.hex }}
        >
          {value === name && <CheckIcon className="size-4" style={{ color: c.ink }} />}
        </button>
      ))}
    </div>
  );
}

/** A tiny chat that shows exactly what the chosen theme, colors and wallpaper look like. */
function AppearancePreview({ me }: { me: Me }) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800" aria-label="Preview" role="img">
      <div className="flex items-center gap-2.5 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex size-8 items-center justify-center rounded-full bg-rose-500 text-xs font-semibold text-white">MA</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Marinas</span>
          <span className="block text-xs text-accent-fg">Online</span>
        </span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
          2
        </span>
      </div>
      <div className={`chat-wall wall-${me.settings.wallpaper} space-y-1.5 px-3 py-3 transition-colors`}>
        <div className="flex">
          <span className="rounded-2xl rounded-bl-md bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5">
            Did you see the new colors? 🎨
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="rounded-2xl rounded-br-md bg-bubble px-3 py-1.5 text-sm text-bubble-ink transition-colors">
            Yes! Check this out <span className="underline underline-offset-2">relay.app</span>
          </span>
          <span className="mt-0.5 mr-1 flex items-center gap-1 text-[11px] text-zinc-400">
            9:41 <span className="text-accent-fg">✓✓</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="h-8 flex-1 rounded-full bg-zinc-100 px-3 text-xs leading-8 text-zinc-400 dark:bg-zinc-800">Message</span>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink">
          <SendIcon className="size-4" />
        </span>
      </div>
    </div>
  );
}

// ---------- Notifications ----------

function NotificationsTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");

  async function toggleNotifications() {
    if (me.settings.notifications) return save({ notifications: false });
    if (!supported) return;
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") save({ notifications: true });
  }

  return (
    <div className="space-y-4">
      <ToggleRow
        title="Desktop notifications"
        description={
          !supported
            ? "Not supported in this browser."
            : permission === "denied"
              ? "Blocked by your browser. Allow notifications for this site in your browser settings."
              : "Get notified about new messages when Relay is in the background."
        }
        checked={me.settings.notifications && permission === "granted"}
        disabled={!supported || permission === "denied"}
        onChange={toggleNotifications}
      />
      <ToggleRow
        title="Message sounds"
        description="Play a soft sound for new messages in other chats."
        checked={me.settings.sounds}
        onChange={() => {
          if (!me.settings.sounds) playMessageSound();
          save({ sounds: !me.settings.sounds });
        }}
      />
      {error && <StatusLine status={{ kind: "error", text: error }} />}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
        disabled={disabled}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          checked ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}

// ---------- Password ----------

function PasswordTab() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const tooShort = next.length > 0 && next.length < LIMITS.passwordMin;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current && next.length >= LIMITS.passwordMin && next === confirm && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setStatus(null);
    try {
      await api.account.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ kind: "success", text: "Password changed. Your other devices have been signed out." });
    } catch (err) {
      setStatus({ kind: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Current password</span>
        <input
          type="password"
          className={inputClass}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          maxLength={LIMITS.passwordMax}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">New password</span>
        <input
          type="password"
          className={inputClass}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          maxLength={LIMITS.passwordMax}
          aria-invalid={tooShort}
        />
        <span className={`mt-1.5 block text-xs ${tooShort ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
          At least {LIMITS.passwordMin} characters.
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Confirm new password</span>
        <input
          type="password"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          maxLength={LIMITS.passwordMax}
          aria-invalid={mismatch}
        />
        {mismatch && <span className="mt-1.5 block text-xs text-red-600 dark:text-red-400">Passwords don't match.</span>}
      </label>
      <StatusLine status={status} />
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={!canSubmit} className={primaryButton}>
          {busy && <Spinner />}
          Change password
        </button>
      </div>
    </form>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const ok = status.kind === "success";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
        ok
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      }`}
    >
      {ok ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : <AlertIcon className="mt-0.5 size-4 shrink-0" />}
      {status.text}
    </div>
  );
}
