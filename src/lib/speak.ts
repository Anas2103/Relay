import { TRANSLATE_LANGUAGES, type TranslateLang } from "../../shared/types";

/**
 * "Read aloud": reads a message with a text-to-speech voice. Voices built into the
 * device are always preferred: some browsers (Chrome) also offer online voices
 * that send the text to the browser maker's servers. In secret chats only
 * on-device voices are used, so the text never leaves the device.
 */
export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

let speakingId: string | null = null;

export function isSpeaking(id: string): boolean {
  return speakingId === id && canSpeak && speechSynthesis.speaking;
}

/** Strips formatting marks so they aren't read out ("asterisk asterisk"). */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\|\|(.+?)\|\|/g, "$1")
    .replace(/(\*\*|__|~~|`|\*|_)/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/https?:\/\/\S+/g, "a link");
}

/** Guesses the language from the script, so Arabic or French text gets a matching voice. */
function guessLang(text: string): string | undefined {
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return "fr";
  return undefined;
}

/** Returns false when it couldn't read it privately (no on-device voice and `localOnly`). */
export function toggleSpeak(id: string, text: string, opts: { localOnly?: boolean } = {}): boolean {
  if (!canSpeak) return false;
  const wasThis = speakingId === id && speechSynthesis.speaking;
  speechSynthesis.cancel();
  speakingId = null;
  if (wasThis) return true;
  const u = new SpeechSynthesisUtterance(plain(text).slice(0, 4000));
  const lang = guessLang(text) ?? (navigator.language || "en").slice(0, 2).toLowerCase();
  const voices = speechSynthesis.getVoices();
  const local = voices.filter((v) => v.localService);
  const matches = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith(lang);
  const voice =
    local.find((v) => matches(v) && v.default) ?? local.find(matches) ?? (opts.localOnly ? (local.find((v) => v.default) ?? local[0]) : voices.find(matches));
  if (opts.localOnly && !voice) return false;
  u.lang = voice?.lang ?? lang;
  if (voice) u.voice = voice;
  u.rate = 1;
  u.onend = u.onerror = () => {
    if (speakingId === id) speakingId = null;
  };
  speakingId = id;
  speechSynthesis.speak(u);
  return true;
}

/** The language to translate into: your setting, else this device's language, else English. */
export function translateTarget(setting: string): TranslateLang {
  const supported = TRANSLATE_LANGUAGES.map(([c]) => c) as readonly string[];
  if (supported.includes(setting)) return setting as TranslateLang;
  const device = (navigator.language || "en").slice(0, 2).toLowerCase();
  return (supported.includes(device) ? device : "en") as TranslateLang;
}
