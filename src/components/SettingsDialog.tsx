import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  bubbleLook,
  colorInfo,
  DARK_THEMES,
  FONTS,
  GRADIENTS,
  isHexColor,
  LIGHT_THEMES,
  LIMITS,
  PALETTE,
  WALLPAPERS,
  type AccentColor,
  type BlockedUser,
  type ColorName,
  type DarkTheme,
  type FontName,
  type GradientName,
  type LightTheme,
  type Me,
  type NoiseSuppression,
  type Settings,
  type Theme,
  type Wallpaper,
} from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { createAudioContext, micConstraints, processMic, type VoiceSettings } from "../lib/audio";
import { hasAnySecretKeys } from "../lib/e2e";
import { deviceProblem, prepareAvatar, type DeviceProblem } from "../lib/media";
import { canInstall, disablePush, enablePush, install, isInstalled, onInstallChange, pushStatus, type PushStatus } from "../lib/pwa";
import { playMessageSound } from "../lib/sound";
import { ConfirmDialog } from "./Dialogs";
import { PasswordStrength } from "./PasswordStrength";
import { SecuritySettings } from "./SecuritySettings";
import { profileLink } from "./InviteDialog";
import { passwordProblem } from "../../shared/password";
import { DeviceHelp } from "./DeviceHelp";
import {
  AlertIcon,
  Avatar,
  BackIcon,
  BellIcon,
  CameraIcon,
  ChatIcon,
  CheckIcon,
  ChevronRightIcon,
  DatabaseIcon,
  DownloadIcon,
  LockIcon,
  LogoutIcon,
  MicIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SendIcon,
  Spinner,
  SunIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "./ui";

type Section = "profile" | "appearance" | "chats" | "notifications" | "privacy" | "voice" | "data";

const SECTIONS: { id: Section; label: string; hint: string; icon: ReactNode; color: string }[] = [
  { id: "profile", label: "Profile", hint: "Photo, name and bio", icon: <UserIcon />, color: "bg-sky-500" },
  { id: "appearance", label: "Appearance", hint: "Theme, colors, bubbles, wallpaper", icon: <PaletteIcon />, color: "bg-fuchsia-500" },
  { id: "chats", label: "Chats & text", hint: "Text size, font, layout, keys", icon: <ChatIcon />, color: "bg-emerald-500" },
  { id: "notifications", label: "Notifications", hint: "Alerts, sounds, install app", icon: <BellIcon />, color: "bg-rose-500" },
  { id: "privacy", label: "Privacy & security", hint: "2-step, devices, passcode, blocked", icon: <LockIcon />, color: "bg-amber-500" },
  { id: "voice", label: "Voice & video", hint: "Noise suppression, mic test", icon: <MicIcon />, color: "bg-violet-500" },
  { id: "data", label: "Your data", hint: "Export or delete your account", icon: <DatabaseIcon />, color: "bg-zinc-500" },
];

const inputClass =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm outline-none transition " +
  "placeholder:text-zinc-400 focus:border-accent focus:ring-4 focus:ring-accent/15 " +
  "dark:border-zinc-700 dark:bg-zinc-800";

const primaryButton =
  "flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink " +
  "shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type Status = { kind: "error" | "success"; text: string } | null;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

/** Full screen on phones (list → page), two columns on bigger screens. */
export function SettingsDialog({
  me,
  onClose,
  onMeUpdated,
  onLogout,
}: {
  me: Me;
  onClose: () => void;
  onMeUpdated: (me: Me) => void;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<Section | null>(() => (window.matchMedia("(min-width: 768px)").matches ? "profile" : null));
  const [confirmLogout, setConfirmLogout] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A sheet opened from Settings (2-step setup, passcode…) closes first, on its own.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      if (section && !window.matchMedia("(min-width: 768px)").matches) setSection(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, section]);

  async function signOut() {
    setConfirmLogout(
      (await hasAnySecretKeys())
        ? "Signing out removes your secret chats' keys from this device, so you won't be able to read them here again (like Telegram). Your normal chats are kept."
        : "You can sign back in any time.",
    );
  }

  const current = SECTIONS.find((s) => s.id === section);

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-zinc-950/50 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="safe-top flex w-full flex-col overflow-hidden bg-white shadow-2xl md:h-[min(760px,92dvh)] md:max-w-4xl md:flex-row md:rounded-3xl dark:bg-zinc-900"
      >
        {/* Section list */}
        <nav className={`flex-col border-zinc-200 md:flex md:w-64 md:shrink-0 md:border-r dark:border-zinc-800 ${section ? "hidden" : "flex"} min-h-0 flex-1 md:flex-none`} aria-label="Settings sections">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-lg font-semibold">Settings</h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 md:hidden dark:hover:bg-zinc-800" aria-label="Close">
              <XIcon className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <button onClick={() => setSection("profile")} className="mb-2 flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800">
              <Avatar name={me.displayName} seed={me.id} user={me} size="lg" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{me.displayName}</span>
                <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">@{me.username}</span>
              </span>
            </button>
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSection(s.id)}
                    aria-current={section === s.id ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                      section === s.id ? "bg-accent/10 dark:bg-accent/20" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-white ${s.color} [&>svg]:size-4.5`}>{s.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{s.label}</span>
                      <span className="block truncate text-xs text-zinc-500 md:hidden dark:text-zinc-400">{s.hint}</span>
                    </span>
                    <ChevronRightIcon className="size-4 text-zinc-400 md:hidden" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-zinc-200 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-zinc-800">
            <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              <span className="flex size-8 items-center justify-center rounded-lg bg-red-500 text-white">
                <LogoutIcon className="size-4" />
              </span>
              Sign out
            </button>
          </div>
        </nav>

        {/* Section content */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${section ? "flex" : "hidden md:flex"}`}>
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-3 md:px-6 md:py-4 dark:border-zinc-800">
            <button onClick={() => setSection(null)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800" aria-label="Back to settings">
              <BackIcon className="size-5" />
            </button>
            <h3 className="flex-1 truncate text-base font-semibold md:text-lg">{current?.label}</h3>
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" aria-label="Close settings">
              <XIcon className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-7">
            {section === "profile" && (
              <>
                <ProfileTab me={me} onMeUpdated={onMeUpdated} />
                <StatusSection me={me} onMeUpdated={onMeUpdated} />
              </>
            )}
            {section === "appearance" && <AppearanceTab me={me} onMeUpdated={onMeUpdated} />}
            {section === "chats" && <ChatsTab me={me} onMeUpdated={onMeUpdated} />}
            {section === "notifications" && <NotificationsTab me={me} onMeUpdated={onMeUpdated} />}
            {section === "privacy" && <PrivacyTab me={me} onMeUpdated={onMeUpdated} />}
            {section === "voice" && <VoiceTab me={me} onMeUpdated={onMeUpdated} />}
            {section === "data" && <DataTab me={me} />}
          </div>
        </div>
      </div>
      {confirmLogout && (
        <ConfirmDialog title="Sign out?" message={confirmLogout} confirmLabel="Sign out" danger onConfirm={onLogout} onClose={() => setConfirmLogout(null)} />
      )}
    </div>
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
    <form onSubmit={save} className="mx-auto max-w-xl space-y-5">
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <button type="button" onClick={() => fileRef.current?.click()} className="group avatar-shape relative" aria-label="Change profile picture" disabled={busy !== null}>
          <Avatar name={me.displayName} seed={me.id} user={me} size="xl" />
          <span className="avatar-shape absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            {busy === "avatar" ? <Spinner className="size-6" /> : <CameraIcon className="size-6" />}
          </span>
        </button>
        <div className="space-y-2">
          <p className="font-medium">{me.displayName}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            @{me.username}
            {me.superAdmin ? " · Owner" : me.role === "admin" ? " · Admin" : ""}
          </p>
          <div className="flex justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="rounded-lg px-2.5 py-1 text-sm font-medium text-accent-fg ring-1 ring-accent/30 transition hover:bg-accent/10 disabled:opacity-50"
            >
              {me.avatarVersion ? "Change photo" : "Add photo"}
            </button>
            {me.avatarVersion && (
              <button type="button" onClick={removePicture} disabled={busy !== null} className="rounded-lg px-2.5 py-1 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
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
        <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={LIMITS.displayNameMax} autoComplete="nickname" />
      </label>
      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-medium">
          Bio
          <span className="font-normal text-zinc-400 tabular-nums">
            {bio.length}/{LIMITS.bioMax}
          </span>
        </span>
        <textarea className={`${inputClass} resize-none`} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bioMax} placeholder="A few words about you" />
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

// ---------- Saving settings ----------

function useSettingSaver(me: Me, onMeUpdated: (me: Me) => void) {
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  async function save(patch: Partial<Settings>) {
    const previous = meRef.current;
    // Apply instantly, then confirm with the server.
    onMeUpdated({ ...previous, settings: { ...previous.settings, ...patch } });
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

/** For sliders: shows the change live, saves once you let go. */
function useLiveSetting<K extends keyof Settings>(me: Me, onMeUpdated: (me: Me) => void, key: K, save: (p: Partial<Settings>) => void) {
  const timer = useRef<number | undefined>(undefined);
  return (value: Settings[K]) => {
    onMeUpdated({ ...me, settings: { ...me.settings, [key]: value } });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save({ [key]: value } as Partial<Settings>), 400);
  };
}

// ---------- Appearance ----------

function AppearanceTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const s = me.settings;
  const themes: [Theme, string, ReactNode][] = [
    ["system", "System", <MonitorIcon key="s" className="size-5" />],
    ["light", "Light", <SunIcon key="l" className="size-5" />],
    ["dark", "Dark", <MoonIcon key="d" className="size-5" />],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <AppearancePreview me={me} />

      <section>
        <SectionTitle title="Theme" />
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {themes.map(([value, label, icon]) => (
            <button
              key={value}
              role="radio"
              aria-checked={s.theme === value}
              onClick={() => save({ theme: value })}
              className={`flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium ring-1 transition ${
                s.theme === value ? "bg-accent/10 text-accent-fg ring-2 ring-accent" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <StylePicker
            label="Light style"
            options={LIGHT_THEMES}
            value={s.lightTheme}
            swatches={{
              classic: ["#ffffff", "#f4f4f5"],
              cream: ["#fffdf8", "#f3ecdd"],
              cool: ["#fbfdff", "#e7edf4"],
              rose: ["#fffbfc", "#fbe4ea"],
              mint: ["#fbfffd", "#dff3ea"],
              lilac: ["#fdfcff", "#ece6fb"],
              sky: ["#fbfeff", "#e0f1fc"],
              sand: ["#fffefa", "#efe7d6"],
              peach: ["#fffbf7", "#fbe7d6"],
              fog: ["#fafafa", "#e6e6e6"],
            }}
            onPick={(v) => save({ lightTheme: v as LightTheme, theme: s.theme === "dark" ? "light" : s.theme })}
          />
          <StylePicker
            label="Dark style"
            options={DARK_THEMES}
            value={s.darkTheme}
            swatches={{
              classic: ["#18181b", "#09090b"],
              dim: ["#1c2938", "#15202b"],
              amoled: ["#050505", "#000000"],
              midnight: ["#0d1428", "#070b1a"],
              forest: ["#0f1d17", "#0a1410"],
              wine: ["#221016", "#170a0f"],
              ocean: ["#0b1e29", "#06141c"],
              mocha: ["#1f1915", "#15110e"],
              grape: ["#1b1328", "#120c1c"],
              nordic: ["#2e3440", "#242933"],
              slate: ["#111827", "#0b1120"],
              plum: ["#241024", "#1a0b1a"],
            }}
            onPick={(v) => save({ darkTheme: v as DarkTheme, theme: s.theme === "light" ? "dark" : s.theme })}
          />
        </div>
      </section>

      <section>
        <SectionTitle title="App color" hint="Buttons, links, badges and highlights. Pick any color: text on it always stays readable." />
        <Swatches label="App color" value={s.accentColor} onPick={(c) => save({ accentColor: c })} />
        <CustomColor value={s.accentColor} onPick={(c) => save({ accentColor: c })} />
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <SectionTitle title="Your bubble" hint="Your messages. Your friends see this color too." />
          {s.bubbleColor !== s.accentColor && (
            <button onClick={() => save({ bubbleColor: s.accentColor })} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent/10">
              Match app color
            </button>
          )}
        </div>
        <p className="mt-3 text-xs font-medium tracking-wide text-zinc-400 uppercase">Colors</p>
        <Swatches label="Bubble color" value={s.bubbleColor} onPick={(c) => save({ bubbleColor: c })} />
        <CustomColor value={s.bubbleColor} onPick={(c) => save({ bubbleColor: c })} />
        <p className="mt-4 text-xs font-medium tracking-wide text-zinc-400 uppercase">Gradients</p>
        <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Bubble gradient">
          {(Object.keys(GRADIENTS) as GradientName[]).map((name) => {
            const look = bubbleLook(name);
            const selected = s.bubbleColor === name;
            return (
              <button
                key={name}
                role="radio"
                aria-checked={selected}
                aria-label={GRADIENTS[name].label}
                title={GRADIENTS[name].label}
                onClick={() => save({ bubbleColor: name })}
                className={`flex size-9 items-center justify-center rounded-full transition hover:scale-110 ${selected ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900" : ""}`}
                style={{ background: look.background, ["--tw-ring-color" as string]: look.solid }}
              >
                {selected && <CheckIcon className="size-4" style={{ color: look.ink }} />}
              </button>
            );
          })}
        </div>
        <div className="mt-5">
          <ToggleRow
            title="Show friends' bubble colors"
            description="See each friend's chosen color on their messages. Turn off to keep everyone's bubbles neutral."
            checked={s.showOthersBubbles}
            onChange={() => save({ showOthersBubbles: !s.showOthersBubbles })}
          />
        </div>
      </section>

      <section>
        <SectionTitle title="Chat wallpaper" />
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5" role="radiogroup" aria-label="Chat wallpaper">
          {(Object.entries(WALLPAPERS) as [Wallpaper, string][]).map(([name, label]) => (
            <button key={name} role="radio" aria-checked={s.wallpaper === name} onClick={() => save({ wallpaper: name })} className="group flex flex-col items-center gap-1.5">
              <span
                className={`chat-wall wall-${name} relative flex h-16 w-full items-end justify-end overflow-hidden rounded-xl p-1.5 ring-1 transition group-hover:scale-[1.03] ${
                  s.wallpaper === name ? "ring-2 ring-accent" : "ring-zinc-200 dark:ring-zinc-700"
                }`}
              >
                <span className="bubble-fill h-2.5 w-7 rounded-full" />
                {s.wallpaper === name && (
                  <span className="absolute top-1.5 left-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </span>
              <span className={`text-xs ${s.wallpaper === name ? "font-semibold text-accent-fg" : "text-zinc-500 dark:text-zinc-400"}`}>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle title="Shapes & motion" />
        <Segmented
          label="Profile pictures"
          value={s.avatarShape}
          options={[
            ["circle", "Circle"],
            ["rounded", "Rounded"],
            ["square", "Square"],
          ]}
          onPick={(v) => save({ avatarShape: v })}
        />
        <ToggleRow title="Animations" description="Message pop-ins, transitions and effects. Turn off for a calmer, faster feel." checked={s.animations} onChange={() => save({ animations: !s.animations })} />
      </section>

      {error && <StatusLine status={{ kind: "error", text: error }} />}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Your appearance syncs across all your devices.</p>
    </div>
  );
}

// ---------- Chats & text ----------

function ChatsTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const s = me.settings;
  const setMessageSize = useLiveSetting(me, onMeUpdated, "messageSize", save);
  const setUiScale = useLiveSetting(me, onMeUpdated, "uiScale", save);
  const setRadius = useLiveSetting(me, onMeUpdated, "bubbleRadius", save);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <AppearancePreview me={me} />

      <section className="space-y-5">
        <SectionTitle title="Text" />
        <Slider label="Message text size" value={s.messageSize} min={12} max={22} unit="px" onChange={setMessageSize} />
        <Slider label="App size" hint="Makes everything bigger or smaller." value={s.uiScale} min={85} max={125} step={5} unit="%" onChange={setUiScale} />
        <div>
          <p className="mb-2 text-sm font-medium">Font</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Font">
            {(Object.entries(FONTS) as [FontName, (typeof FONTS)[FontName]][]).map(([id, f]) => (
              <button
                key={id}
                role="radio"
                aria-checked={s.font === id}
                onClick={() => save({ font: id })}
                className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${s.font === id ? "bg-accent/10 ring-2 ring-accent" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"}`}
                style={{ fontFamily: f.stack }}
              >
                <span className="block text-lg leading-tight">Aa</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <SectionTitle title="Layout" />
        <Slider label="Bubble corners" value={s.bubbleRadius} min={4} max={24} unit="px" onChange={setRadius} />
        <Segmented
          label="Spacing"
          value={s.density}
          options={[
            ["compact", "Compact"],
            ["comfortable", "Comfortable"],
            ["spacious", "Spacious"],
          ]}
          onPick={(v) => save({ density: v })}
        />
        <Segmented
          label="Chat width (big screens)"
          value={s.chatWidth}
          options={[
            ["narrow", "Narrow"],
            ["normal", "Normal"],
            ["wide", "Wide"],
          ]}
          onPick={(v) => save({ chatWidth: v })}
        />
        <Segmented
          label="Time format"
          value={s.timeFormat}
          options={[
            ["auto", "Automatic"],
            ["12h", "12-hour"],
            ["24h", "24-hour"],
          ]}
          onPick={(v) => save({ timeFormat: v })}
        />
      </section>

      <section className="space-y-4">
        <SectionTitle title="Messages" />
        <ToggleRow title="Big emoji" description="Messages of just 1 to 3 emoji are shown large, without a bubble." checked={s.bigEmoji} onChange={() => save({ bigEmoji: !s.bigEmoji })} />
        <ToggleRow
          title="Link previews"
          description="Show the title of web pages people send. Fetched by our server, so the site never sees your IP. Never in secret chats."
          checked={s.linkPreviews}
          onChange={() => save({ linkPreviews: !s.linkPreviews })}
        />
        <ToggleRow
          title="Enter sends the message"
          description={s.enterToSend ? "Shift+Enter adds a new line. (On phones, use the send button.)" : "Enter adds a new line; Ctrl+Enter (⌘+Enter on Mac) sends."}
          checked={s.enterToSend}
          onChange={() => save({ enterToSend: !s.enterToSend })}
        />
      </section>

      <section className="space-y-4">
        <SectionTitle title="Chat list" />
        <ToggleRow title="Message previews" description="Show the last message under each chat." checked={s.listPreviews} onChange={() => save({ listPreviews: !s.listPreviews })} />
        <ToggleRow title={`"Online now" row`} description="Friends who are online, at the top of your chats." checked={s.showOnlineRow} onChange={() => save({ showOnlineRow: !s.showOnlineRow })} />
      </section>
      {error && <StatusLine status={{ kind: "error", text: error }} />}
    </div>
  );
}

// ---------- Small building blocks ----------

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-accent-fg tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
        aria-valuetext={`${value}${unit}`}
      />
    </label>
  );
}

function Segmented<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="grid gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onPick(v)}
            className={`truncate rounded-lg px-2 py-1.5 text-sm font-medium transition ${
              value === v ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function StylePicker({
  label,
  options,
  value,
  swatches,
  onPick,
}: {
  label: string;
  options: Record<string, string>;
  value: string;
  swatches: Record<string, [string, string]>;
  onPick: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {Object.entries(options).map(([id, name]) => (
          <button
            key={id}
            role="radio"
            aria-checked={value === id}
            onClick={() => onPick(id)}
            className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-medium ring-1 transition ${
              value === id ? "bg-accent/10 text-accent-fg ring-2 ring-accent" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            <span
              className="size-5 rounded-full ring-1 ring-black/10 dark:ring-white/15"
              style={{ background: `linear-gradient(135deg, ${swatches[id]?.[0] ?? "#fff"} 50%, ${swatches[id]?.[1] ?? "#eee"} 50%)` }}
            />
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Swatches({ label, value, onPick }: { label: string; value: string; onPick: (c: ColorName) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label={label}>
      {(Object.entries(PALETTE) as [ColorName, (typeof PALETTE)[ColorName]][]).map(([name, c]) => (
        <button
          key={name}
          role="radio"
          aria-checked={value === name}
          aria-label={c.label}
          title={c.label}
          onClick={() => onPick(name)}
          className={`flex size-9 items-center justify-center rounded-full transition hover:scale-110 ${value === name ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900" : ""}`}
          style={{ backgroundColor: c.hex, ["--tw-ring-color" as string]: c.hex }}
        >
          {value === name && <CheckIcon className="size-4" style={{ color: c.ink }} />}
        </button>
      ))}
    </div>
  );
}

/** Any color at all, with a live picker. Readable text colors are worked out automatically. */
function CustomColor({ value, onPick }: { value: string; onPick: (c: AccentColor) => void }) {
  const custom = isHexColor(value);
  const [draft, setDraft] = useState<string>(custom ? value : "#6d28d9");
  const timer = useRef<number | undefined>(undefined);
  const info = colorInfo(draft as AccentColor);
  return (
    <div className={`mt-3 flex items-center gap-3 rounded-xl p-2 ring-1 ${custom ? "ring-2 ring-accent" : "ring-zinc-200 dark:ring-zinc-700"}`}>
      <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-black/10" style={{ background: draft }} title="Pick a custom color">
        <input
          type="color"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => onPick(v as AccentColor), 250);
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label="Custom color"
        />
        {custom && <CheckIcon className="absolute inset-0 m-auto size-4" style={{ color: info.ink }} />}
      </label>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Custom color</span>
        <span className="block font-mono text-xs text-zinc-500 uppercase dark:text-zinc-400">{draft}</span>
      </span>
      {!custom && (
        <button onClick={() => onPick(draft as AccentColor)} className="rounded-lg px-3 py-2 text-xs font-semibold text-accent-fg ring-1 ring-accent/30 hover:bg-accent/10">
          Use
        </button>
      )}
    </div>
  );
}

/** A tiny chat showing exactly what the theme, colors, text and wallpaper look like, including a friend's bubble. */
function AppearancePreview({ me }: { me: Me }) {
  const friend = bubbleLook("g-berry");
  const showFriend = me.settings.showOthersBubbles;
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800" aria-label="Preview" role="img">
      <div className="flex items-center gap-2.5 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="avatar-shape flex size-8 items-center justify-center bg-rose-500 text-xs font-semibold text-white">MA</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Marinas</span>
          <span className="block text-xs text-accent-fg">Online</span>
        </span>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">2</span>
      </div>
      <div className={`chat-wall wall-${me.settings.wallpaper} px-3 py-3 transition-colors`}>
        <div className="flex">
          <span
            className={`msg-text bubble-shape join-bl bubble-pad ${showFriend ? "shadow-sm" : "bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5"}`}
            style={showFriend ? { background: friend.background, color: friend.ink } : undefined}
          >
            I picked the Berry gradient 💜
          </span>
        </div>
        <div className="group-gap flex flex-col items-end">
          <span className="msg-text bubble-fill bubble-shape join-br bubble-pad transition-colors">
            Love it! Mine's this one <span className="underline underline-offset-2">relay.app</span>
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

// ---------- Voice & video ----------

const SUPPRESSION: [NoiseSuppression, string, string][] = [
  ["ai", "AI noise suppression", "A neural network removes fans, keyboards, traffic and background voices while keeping yours clear, like Discord's Krisp."],
  ["standard", "Standard", "Your browser's built-in noise filter. Lighter, but lets more background noise through."],
  ["off", "Off", "Your raw microphone. Best for music or a professional mic."],
];

function VoiceTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const s = me.settings;
  return (
    <div className="space-y-7">
      <section>
        <SectionTitle title="Noise suppression" hint="Used in calls and voice messages. Everything runs on your device." />
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Noise suppression">
          {SUPPRESSION.map(([value, title, description]) => (
            <button
              key={value}
              role="radio"
              aria-checked={s.noiseSuppression === value}
              onClick={() => save({ noiseSuppression: value })}
              className={`flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition ${
                s.noiseSuppression === value
                  ? "bg-accent/10 ring-2 ring-accent"
                  : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-2 ${
                  s.noiseSuppression === value ? "ring-accent" : "ring-zinc-300 dark:ring-zinc-600"
                }`}
              >
                {s.noiseSuppression === value && <span className="size-2 rounded-full bg-accent" />}
              </span>
              <span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {title}
                  {value === "ai" && (
                    <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-ink uppercase">
                      Best
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle title="Voice processing" />
        <ToggleRow
          title="Echo cancellation"
          description="Stops the other person hearing themselves through your speakers."
          checked={s.echoCancellation}
          onChange={() => save({ echoCancellation: !s.echoCancellation })}
        />
        <ToggleRow
          title="Automatic gain control"
          description="Keeps your volume steady whether you whisper or shout."
          checked={s.autoGainControl}
          onChange={() => save({ autoGainControl: !s.autoGainControl })}
        />
        <ToggleRow
          title="Noise gate"
          description="Fully silences your mic between words, so quiet background sounds never get through."
          checked={s.noiseGate}
          onChange={() => save({ noiseGate: !s.noiseGate })}
        />
        <ToggleRow
          title="Clean up the other person's voice"
          description="Also runs AI noise suppression on what you hear, on your device. Useful when a friend calls from somewhere noisy."
          checked={s.cleanIncoming}
          onChange={() => save({ cleanIncoming: !s.cleanIncoming })}
        />
      </section>

      <MicTest voice={s} />
      {error && <StatusLine status={{ kind: "error", text: error }} />}
    </div>
  );
}

/** Like Discord's "Let's check": a live level meter with your settings applied, and optional listen-back. */
function MicTest({ voice }: { voice: VoiceSettings }) {
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [mode, setMode] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | undefined>(undefined);
  const [listen, setListen] = useState(false);
  const [problem, setProblem] = useState<DeviceProblem | null>(null);
  const session = useRef<{ stop: () => void; setListen: (on: boolean) => void } | null>(null);

  // Restart with new settings when they change mid-test.
  const key = JSON.stringify(voice);
  useEffect(() => {
    if (!running) return;
    session.current?.stop();
    session.current = null;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => session.current?.stop(), []);

  async function start() {
    const ctx = createAudioContext();
    let raw: MediaStream;
    try {
      raw = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(voice) });
    } catch (err) {
      ctx.close().catch(() => {});
      setProblem(deviceProblem(err));
      setRunning(false);
      return;
    }
    const processed = await processMic(raw, voice, ctx);
    const source = ctx.createMediaStreamSource(processed.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const monitor = ctx.createGain();
    monitor.gain.value = 0;
    source.connect(monitor).connect(ctx.destination);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-8);
      setLevel(Math.min(1, Math.max(0, (db + 60) / 55)));
      raf = requestAnimationFrame(tick);
    };
    tick();
    setMode(processed.mode);
    setEngine(processed.engine);
    session.current = {
      stop: () => {
        cancelAnimationFrame(raf);
        processed.dispose();
        raw.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        setLevel(0);
      },
      setListen: (on) => monitor.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05),
    };
    session.current.setListen(listen);
  }

  function toggle() {
    if (running) {
      session.current?.stop();
      session.current = null;
      setRunning(false);
      setListen(false);
    } else {
      setRunning(true);
      void start();
    }
  }

  return (
    <section className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/60">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title="Mic test" hint={running ? "Say something — this is how you sound to others." : "Check your microphone with these settings."} />
        <button
          onClick={toggle}
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            running ? "bg-red-600 text-white hover:bg-red-500" : "bg-accent text-accent-ink hover:opacity-90"
          }`}
        >
          {running ? "Stop" : "Let's check"}
        </button>
      </div>
      <div className="mt-4 flex h-3 gap-[3px]" aria-label="Microphone level" role="meter" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: 32 }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full transition-colors duration-75 ${
              i / 32 < level ? (i > 26 ? "bg-red-500" : i > 20 ? "bg-amber-400" : "bg-emerald-500") : "bg-zinc-200 dark:bg-zinc-700"
            }`}
          />
        ))}
      </div>
      {running && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Active:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {mode === "ai" ? `AI noise suppression (${engine === "gtcrn" ? "GTCRN, max quality" : "RNNoise, battery saver"})` : mode === "standard" ? "Standard" : "Off"}
              {mode && mode !== voice.noiseSuppression && " (AI isn't supported in this browser)"}
            </span>
          </span>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={listen}
              onChange={(e) => {
                setListen(e.target.checked);
                session.current?.setListen(e.target.checked);
              }}
              className="accent-[var(--accent)]"
            />
            Hear yourself (use headphones)
          </label>
        </div>
      )}
      {problem && <DeviceHelp problem={problem} device="microphone" onClose={() => setProblem(null)} />}
    </section>
  );
}

// ---------- Notifications ----------

function NotificationsTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [installable, setInstallable] = useState(canInstall());

  useEffect(() => {
    pushStatus().then(setPush, () => setPush("unsupported"));
    return onInstallChange(() => setInstallable(canInstall()));
  }, []);

  async function toggleNotifications() {
    if (me.settings.notifications) return save({ notifications: false });
    if (!supported) return;
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") save({ notifications: true });
  }

  async function togglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      setPush(push === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      setPushError(errText(err));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-4">
        <SectionTitle title="Alerts" />
        <ToggleRow
          title="Notifications while Relay is open"
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
          title="Push notifications"
          description={
            push === "unsupported"
              ? "Not supported in this browser. On iPhone, add Relay to your Home Screen first."
              : push === "unconfigured"
                ? "Not set up on this server yet."
                : push === "denied"
                  ? "Blocked by your browser. Allow notifications for this site in your browser settings."
                  : "Get notified even when Relay is closed. Pushes never contain your messages, just that something arrived."
          }
          checked={push === "on"}
          disabled={pushBusy || push === null || push === "unsupported" || push === "unconfigured" || push === "denied"}
          onChange={togglePush}
        />
        {pushError && <StatusLine status={{ kind: "error", text: pushError }} />}
        <ToggleRow
          title="Show message text"
          description="Notifications show what was said. Turn off to only show who it's from."
          checked={me.settings.notificationPreview}
          onChange={() => save({ notificationPreview: !me.settings.notificationPreview })}
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
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Mute individual chats from their menu (right-click or long-press in the chat list).</p>
      </section>

      <section className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/60">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle
            title="Install the app"
            hint={
              isInstalled()
                ? "Relay is installed on this device. ✓"
                : installable
                  ? "Add Relay to your home screen or desktop. It opens in its own window, like a native app."
                  : "On iPhone/iPad: tap Share, then Add to Home Screen. On other browsers, use the menu's Install option."
            }
          />
          {installable && !isInstalled() && (
            <button onClick={() => install().then(() => setInstallable(canInstall()))} className={`${primaryButton} shrink-0`}>
              <DownloadIcon className="size-4" /> Install
            </button>
          )}
        </div>
      </section>
      {error && <StatusLine status={{ kind: "error", text: error }} />}
    </div>
  );
}

// ---------- Privacy & security ----------

function PrivacyTab({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const s = me.settings;
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-4">
        <SectionTitle title="Privacy" />
        <Segmented
          label="Who can see my last seen & online status"
          value={s.lastSeen}
          options={[
            ["contacts", "My friends"],
            ["nobody", "Nobody"],
          ]}
          onPick={(v) => save({ lastSeen: v })}
        />
        <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {s.lastSeen === "nobody"
            ? "Nobody sees when you're online. Like Telegram, it works both ways: you won't see anyone else's either."
            : "Only people you've accepted a friend request with. Strangers never see it."}
        </p>
        <ToggleRow title="Typing indicator" description={`Let others see "typing…" while you write.`} checked={s.sendTyping} onChange={() => save({ sendTyping: !s.sendTyping })} />
        {error && <StatusLine status={{ kind: "error", text: error }} />}
      </section>

      <section className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
        <p className="flex items-center gap-2 font-semibold">
          <LockIcon className="size-4" /> Secret chats
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          Open any 1:1 chat, tap the name, then <strong>Secret chat</strong>. Messages are end-to-end encrypted on your device: no one else can read them, not even the server or the admins. They only live on the two devices that set them up, and signing out removes them from this device.
        </p>
      </section>

      <SecuritySettings me={me} onMeUpdated={onMeUpdated} />
      <BlockedSection />
      <PasswordSection username={me.username} />
    </div>
  );
}

// ---------- Profile link ----------

function ProfileLinkRow({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const link = profileLink(username);
  return (
    <div className="space-y-2 pb-3">
      <SectionTitle title="Your profile link" hint="Share it so friends can find you in one tap." />
      <div className="flex gap-2">
        <p className="min-w-0 flex-1 truncate rounded-xl bg-zinc-100 px-3.5 py-2.5 font-mono text-xs leading-5 dark:bg-zinc-800" title={link}>
          {link}
        </p>
        <button
          type="button"
          onClick={() => {
            const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share;
            if (share && matchMedia("(pointer: coarse)").matches) share.call(navigator, { title: "Chat with me on Relay", url: link }).catch(() => {});
            else navigator.clipboard?.writeText(link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
          }}
          className={`${primaryButton} shrink-0`}
        >
          {copied ? "Copied ✓" : "Share"}
        </button>
      </div>
    </div>
  );
}

// ---------- Status (Discord-style) ----------

const STATUS_IDEAS = ["💬 Available", "📚 Studying", "💼 At work", "🎮 Gaming", "🏖️ On holiday", "🤒 Off sick", "😴 Sleeping"];

function StatusSection({ me, onMeUpdated }: { me: Me; onMeUpdated: (me: Me) => void }) {
  const { save, error } = useSettingSaver(me, onMeUpdated);
  const [text, setText] = useState(me.statusText);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function saveText(value: string) {
    setBusy(true);
    setStatusError(null);
    try {
      const { user } = await api.account.update({ statusText: value });
      onMeUpdated(user);
      setText(user.statusText);
    } catch (err) {
      setStatusError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const modes: [Settings["presence"], string, string, string][] = [
    ["online", "Online", "bg-emerald-500", "Friends see when you're online."],
    ["dnd", "Do not disturb", "bg-red-500", "No notifications or sounds (security alerts still come through). Friends see you're busy."],
    ["invisible", "Invisible", "bg-zinc-400", "You appear offline to everyone, and (like Telegram) you won't see others online either."],
  ];
  return (
    <div className="mx-auto mt-10 max-w-xl space-y-5 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <ProfileLinkRow username={me.username} />
      <SectionTitle title="Status" hint="Shown on your profile and at the top of your chats." />
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Online status">
        {modes.map(([value, label, dot]) => (
          <button
            key={value}
            role="radio"
            aria-checked={me.settings.presence === value}
            onClick={() => save({ presence: value })}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium ring-1 transition ${
              me.settings.presence === value ? "bg-accent/10 ring-2 ring-accent" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
            {label}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">{modes.find((m) => m[0] === me.settings.presence)?.[3]}</p>
      {error && <StatusLine status={{ kind: "error", text: error }} />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveText(text);
        }}
        className="space-y-2"
      >
        <span className="block text-sm font-medium">Custom status</span>
        <div className="flex gap-2">
          <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={LIMITS.statusMax} placeholder="What's happening?" aria-label="Custom status" />
          <button type="submit" disabled={busy || text.trim() === me.statusText} className={`${primaryButton} shrink-0`}>
            {busy ? <Spinner /> : "Set"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_IDEAS.map((idea) => (
            <button key={idea} type="button" onClick={() => saveText(idea)} className="min-h-9 rounded-full px-3 py-1.5 text-xs ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800">
              {idea}
            </button>
          ))}
          {me.statusText && (
            <button type="button" onClick={() => saveText("")} className="min-h-9 rounded-full px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-600/25 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              Clear
            </button>
          )}
        </div>
        {statusError && <StatusLine status={{ kind: "error", text: statusError }} />}
      </form>
    </div>
  );
}

function BlockedSection() {
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .blocked()
      .then((r) => setBlocked(r.blocked))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load blocked people."));
  }, []);

  async function unblock(u: BlockedUser) {
    setBusy(u.id);
    try {
      await api.unblockUser(u.id);
      setBlocked((prev) => (prev ?? []).filter((b) => b.id !== u.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't unblock. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <SectionTitle title="Blocked people" hint="Blocked people can't message or call you, and you won't see each other's online status." />
      {error && <StatusLine status={{ kind: "error", text: error }} />}
      {!blocked ? (
        <div className="flex justify-center py-6 text-zinc-400">
          <Spinner className="size-5" />
        </div>
      ) : blocked.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">You haven't blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
          {blocked.map((u) => (
            <li key={u.id} className="flex items-center gap-3 bg-white px-3 py-2.5 dark:bg-zinc-900">
              <Avatar name={u.displayName} seed={u.id} user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.displayName}</p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{u.username}</p>
              </div>
              <button
                onClick={() => unblock(u)}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-fg ring-1 ring-accent/30 transition hover:bg-accent/10 disabled:opacity-50"
              >
                {busy === u.id && <Spinner className="size-3.5" />}
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PasswordSection({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const tooShort = next.length > 0 && !!passwordProblem(next, username);
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current && !passwordProblem(next, username) && next === confirm && !busy;

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
      <SectionTitle title="Change password" />
      <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Current password</span>
        <input type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={LIMITS.passwordMax} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">New password</span>
          <input type="password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={LIMITS.passwordMax} aria-invalid={tooShort} />
          <PasswordStrength password={next} username={username} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Confirm new password</span>
          <input type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={LIMITS.passwordMax} aria-invalid={mismatch} />
          {mismatch && <span className="mt-1.5 block text-xs text-red-600 dark:text-red-400">Passwords don't match.</span>}
        </label>
      </div>
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

// ---------- Your data ----------

function DataTab({ me }: { me: Me }) {
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionTitle title="Download your data" hint="Your profile, settings and every message in your chats, as a JSON file. Secret chats stay encrypted." />
          <a href={api.exportUrl} download className={`${primaryButton} shrink-0`}>
            <DownloadIcon className="size-4" /> Export
          </a>
        </div>
      </section>

      <section className="rounded-2xl p-4 ring-1 ring-red-600/25 dark:ring-red-400/25">
        <SectionTitle
          title="Delete my account"
          hint={
            me.superAdmin
              ? "The owner account can't be deleted."
              : "Permanently deletes your account, your 1:1 chats (for both people) and your messages in groups. This can't be undone."
          }
        />
        {!me.superAdmin && (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) setConfirming(true);
            }}
          >
            <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              className={inputClass}
            />
            <button type="submit" disabled={!password} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50">
              <TrashIcon className="size-4" /> Delete account
            </button>
          </form>
        )}
      </section>
      {confirming && (
        <ConfirmDialog
          title="Delete your account forever?"
          message="Everything goes: your profile, your 1:1 chats and your messages in groups. There's no undo."
          confirmLabel="Delete forever"
          danger
          onConfirm={async () => {
            await api.deleteAccount(password);
            window.location.reload();
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// ---------- Shared ----------

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
  // The whole row is the label, so tapping the text toggles it too (big, easy target on phones).
  return (
    <label className={`-mx-2 flex items-start justify-between gap-4 rounded-xl px-2 py-1.5 ${disabled ? "" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onChange}
        disabled={disabled}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-3 before:inset-x-0 before:content-[""] disabled:opacity-40 ${checked ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </label>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  const ok = status.kind === "success";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
        ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      }`}
    >
      {ok ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : <AlertIcon className="mt-0.5 size-4 shrink-0" />}
      {status.text}
    </div>
  );
}
