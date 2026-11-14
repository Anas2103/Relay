/**
 * "Read aloud": reads a message with the device's own text-to-speech voice
 * (nothing is sent anywhere). Handy for long messages or tired eyes.
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

export function toggleSpeak(id: string, text: string): void {
  if (!canSpeak) return;
  const wasThis = speakingId === id && speechSynthesis.speaking;
  speechSynthesis.cancel();
  speakingId = null;
  if (wasThis) return;
  const u = new SpeechSynthesisUtterance(plain(text).slice(0, 4000));
  const lang = guessLang(text);
  if (lang) {
    u.lang = lang;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
  }
  u.rate = 1;
  u.onend = u.onerror = () => {
    if (speakingId === id) speakingId = null;
  };
  speakingId = id;
  speechSynthesis.speak(u);
}
