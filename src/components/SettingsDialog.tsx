import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  bubbleLook,
  DARK_THEMES,
  GRADIENTS,
  LIGHT_THEMES,
  LIMITS,
  PALETTE,
  WALLPAPERS,
  type ColorName,
  type DarkTheme,
  type GradientName,
  type LightTheme,
  type Me,
  type NoiseSuppression,
  type Settings,
  type Theme,
  type Wallpaper,
} from "../../shared/types";
import { createAudioContext, micConstraints, processMic, type VoiceSettings } from "../lib/audio";
import { deviceProblem, type DeviceProblem } from "../lib/media";
import { DeviceHelp } from "./DeviceHelp";
import { api, ApiError } from "../lib/api";
import { prepareAvatar } from "../lib/media";
import { playMessageSound } from "../lib/sound";
import { AlertIcon, Avatar, CameraIcon, CheckIcon, MonitorIcon, MoonIcon, SendIcon, Spinner, SunIcon, XIcon } from "./ui";

type Tab = "profile" | "appearance" | "voice" | "notifications" | "security";

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
    ["voice", "Voice & video"],
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
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 md:px-6">
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
        <nav className="no-scrollbar mt-3 flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-4 md:px-5 dark:border-zinc-800" aria-label="Settings sections">
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
          {tab === "voice" && <VoiceTab me={me} onMeUpdated={onMeUpdated} />}
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
    <div className="space-y-7">
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
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <StylePicker
            label="Light style"
            options={LIGHT_THEMES}
            value={s.lightTheme}
            swatches={{ classic: ["#ffffff", "#f4f4f5"], cream: ["#fffdf8", "#f3ecdd"], cool: ["#fbfdff", "#e7edf4"] }}
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
            }}
            onPick={(v) => save({ darkTheme: v as DarkTheme, theme: s.theme === "light" ? "dark" : s.theme })}
          />
        </div>
      </section>

      <section>
        <SectionTitle title="App color" hint="Buttons, links, badges and highlights." />
        <Swatches label="App color" value={s.accentColor} onPick={(c) => save({ accentColor: c })} />
      </section>

      <section>
        <div className="flex items-end justify-between gap-3">
          <SectionTitle title="Your bubble" hint="Your messages — your friends see this color too." />
          {s.bubbleColor !== s.accentColor && (
            <button
              onClick={() => save({ bubbleColor: s.accentColor })}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-accent-fg hover:bg-accent/10"
            >
              Match app color
            </button>
          )}
        </div>
        <p className="mt-3 text-xs font-medium tracking-wide text-zinc-400 uppercase">Colors</p>
        <Swatches label="Bubble color" value={s.bubbleColor} onPick={(c) => save({ bubbleColor: c })} />
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
                className={`flex size-9 items-center justify-center rounded-full transition hover:scale-110 ${
                  selected ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900" : ""
                }`}
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
                <span className="bubble-fill h-2.5 w-7 rounded-full" />
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
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
              style={{ background: `linear-gradient(135deg, ${swatches[id][0]} 50%, ${swatches[id][1]} 50%)` }}
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

/** A tiny chat showing exactly what the theme, colors and wallpaper look like — including a friend's bubble. */
function AppearancePreview({ me }: { me: Me }) {
  const friend = bubbleLook("g-berry");
  const showFriend = me.settings.showOthersBubbles;
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
          <span
            className={`rounded-2xl rounded-bl-md px-3 py-1.5 text-sm ${
              showFriend ? "shadow-sm" : "bg-white shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:ring-white/5"
            }`}
            style={showFriend ? { background: friend.background, color: friend.ink } : undefined}
          >
            I picked the Berry gradient 💜
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="bubble-fill rounded-2xl rounded-br-md px-3 py-1.5 text-sm transition-colors">
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
