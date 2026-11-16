import { assertAllowed } from "./policy";
import { isEncrypted, TRANSLATE_LANGUAGES, type MessageKind } from "../shared/types";
import { rateLimit, requireUser } from "./auth";
import { room, type Env } from "./env";
import { HttpError, json, readJson } from "./http";
import { assertMember } from "./rooms";

/*
 * On-demand AI helpers, run on Cloudflare Workers AI (free daily allowance):
 *  - transcripts of voice messages (Whisper)
 *  - translation of messages (Gemma 3, which works out the source language itself)
 * Each result is made once and saved, so the same message is never processed twice.
 * Secret chats are never sent here: their text is end-to-end encrypted.
 */

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
/** Good multilingual models, best first; some accounts can't use every one, so the first that works is remembered. */
const TRANSLATORS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
] as const;
let workingTranslator: (typeof TRANSLATORS)[number] | null = null;
const HOUR = 60 * 60 * 1000;

interface MessageInfo {
  kind: MessageKind;
  body: string;
  media_id: string | null;
  deleted_at: number | null;
  meta: string | null;
}

async function loadMessage(env: Env, roomId: string, messageId: string): Promise<MessageInfo> {
  const msg = await env.DB.prepare("SELECT kind, body, media_id, deleted_at, meta FROM messages WHERE id = ?1 AND room_id = ?2")
    .bind(messageId, roomId)
    .first<MessageInfo>();
  if (!msg || msg.deleted_at !== null) throw new HttpError(404, "Message not found.");
  return msg;
}

function needAi(env: Env): Ai {
  if (!env.AI) throw new HttpError(503, "AI features aren't set up on this server.");
  return env.AI;
}

/** POST /api/rooms/:id/messages/:mid/transcript */
export async function transcribe(request: Request, env: Env, roomId: string, messageId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertAllowed(env, me.id, "ai");
  await assertMember(env, roomId, me.id);
  const msg = await loadMessage(env, roomId, messageId);
  if (msg.kind !== "voice" || !msg.media_id) throw new HttpError(400, "Only voice messages can be transcribed.");

  const saved = await env.DB.prepare("SELECT text, language FROM transcripts WHERE message_id = ?1").bind(messageId).first<{ text: string; language: string | null }>();
  if (saved) return json({ text: saved.text, language: saved.language });

  const ai = needAi(env);
  await rateLimit(env, `transcribe:${me.id}`, 40, HOUR);
  const file = await room(env, roomId).getMedia(msg.media_id);
  if (!file) throw new HttpError(404, "Voice message not found.");

  let out: { text?: string; transcription_info?: { language?: string } };
  try {
    out = (await ai.run(WHISPER, { audio: toBase64(file.data), vad_filter: true })) as typeof out;
  } catch (err) {
    console.log("transcribe failed:", err instanceof Error ? err.message : err);
    throw new HttpError(502, "Couldn't transcribe this right now. Try again in a moment.");
  }
  const text = (out.text ?? "").trim() || "(no speech)";
  const language = out.transcription_info?.language ?? null;
  await env.DB.prepare("INSERT OR REPLACE INTO transcripts (message_id, text, language, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(messageId, text, language, Date.now())
    .run();
  return json({ text, language });
}

/** POST /api/rooms/:id/messages/:mid/translate  { lang } */
export async function translate(request: Request, env: Env, roomId: string, messageId: string): Promise<Response> {
  const me = await requireUser(request, env);
  await assertAllowed(env, me.id, "ai");
  await assertMember(env, roomId, me.id);
  const { lang } = await readJson<{ lang?: string }>(request);
  const target = TRANSLATE_LANGUAGES.find(([code]) => code === lang);
  if (!target) throw new HttpError(400, "Unknown language.");
  const msg = await loadMessage(env, roomId, messageId);
  if (isEncrypted(msg.body)) throw new HttpError(400, "Secret chat messages can't be translated (the server can't read them).");

  // Voice messages are translated from their transcript.
  let source = msg.body.trim();
  if (msg.kind === "voice") {
    const t = await env.DB.prepare("SELECT text FROM transcripts WHERE message_id = ?1").bind(messageId).first<{ text: string }>();
    if (!t) throw new HttpError(400, "Transcribe the voice message first.");
    source = t.text;
  }
  if (!source) throw new HttpError(400, "There's no text to translate.");
  source = source.slice(0, 2000);

  const saved = await env.DB.prepare("SELECT text FROM translations WHERE message_id = ?1 AND lang = ?2 AND source = ?3")
    .bind(messageId, target[0], source)
    .first<{ text: string }>();
  if (saved) return json({ text: saved.text });

  const ai = needAi(env);
  await rateLimit(env, `translate:${me.id}`, 120, HOUR);
  let text = "";
  const input = {
    messages: [
      {
        role: "system",
        content: `You translate chat messages into ${target[1]}. Reply with the translation only: no quotes, notes or explanations. Keep emoji, names, links and the casual tone. If it is already in ${target[1]}, return it unchanged.`,
      },
      { role: "user", content: source },
    ],
    max_tokens: 1200,
    temperature: 0.2,
  };
  for (const model of workingTranslator ? [workingTranslator] : TRANSLATORS) {
    try {
      const out = (await ai.run(model as Parameters<Ai["run"]>[0], input as never)) as { response?: string };
      text = (typeof out.response === "string" ? out.response : "").trim();
      workingTranslator = model;
      break;
    } catch (err) {
      console.log(`translate with ${model} failed:`, err instanceof Error ? err.message : err);
      if (workingTranslator) workingTranslator = null; // it stopped working: look again next time
    }
  }
  if (!text) throw new HttpError(502, "Couldn't translate this right now. Try again in a moment.");
  await env.DB.prepare("INSERT OR REPLACE INTO translations (message_id, lang, source, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(messageId, target[0], source, text, Date.now())
    .run();
  return json({ text });
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
