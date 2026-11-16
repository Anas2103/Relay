import { useCallback, useEffect, useRef, useState } from "react";
import { isEncrypted, type Message, type Room } from "../../shared/types";
import { api, ApiError, fetchMedia, mediaUrl } from "./api";
import {
  createDeviceKey,
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  forgetKey,
  parsePhotoBody,
  photoBody,
  secretState,
  type SecretPhoto,
  type SecretState,
} from "./e2e";

/** A message as shown on screen: encrypted bodies replaced by their text, photos by a local copy. */
export type Readable<M extends Message> = M & {
  locked?: boolean;
  /** Blob URL of the decrypted photo (only in this tab's memory). */
  localUrl?: string;
  /** Secret photos: still downloading/decrypting, or it couldn't be decrypted. */
  e2eMedia?: "loading" | "failed";
};

/**
 * Everything a secret chat needs on this device: its state, encrypting before
 * sending, and decrypting what's shown (results are cached, so each message is
 * decrypted once and bubbles keep the same object between renders).
 *
 * Decrypted photos exist only as blob URLs in this tab's memory. They're never
 * written to disk, and they're thrown away when you leave the chat.
 */
export function useSecret(room: Room, meId: string) {
  const [state, setState] = useState<SecretState>(room.secret ? { kind: "loading" } : { kind: "unsupported" });
  const [version, setVersion] = useState(0);
  const plain = useRef(new Map<string, string | null>());
  const views = useRef(new WeakMap<Message, { v: number; out: Message }>());
  const keyRef = useRef<CryptoKey | null>(null);
  /** messageId → decrypted photo (blob URL), or null when it couldn't be decrypted. */
  const photos = useRef(new Map<string, string | null>());
  const fetching = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!room.secret) return;
    try {
      const { secret } = await api.secretInfo(room.id);
      const s = await secretState(secret, meId);
      keyRef.current = s.kind === "ready" ? s.key : null;
      setState(s);
    } catch {
      setState({ kind: "elsewhere" });
    }
  }, [room.id, room.secret, meId]);

  // Re-check when the chat changes state (e.g. the other person accepted).
  useEffect(() => {
    void refresh();
  }, [refresh, room.status]);

  // Leaving the chat: drop every decrypted photo from memory.
  useEffect(() => {
    const map = photos.current;
    return () => {
      for (const url of map.values()) if (url) URL.revokeObjectURL(url);
      map.clear();
    };
  }, [room.id]);

  const accept = useCallback(async () => {
    const key = await createDeviceKey(room.id);
    try {
      await api.acceptSecret(room.id, key);
    } catch (err) {
      await forgetKey(room.id);
      throw err instanceof ApiError ? err : new Error("Couldn't accept the secret chat.");
    }
    await refresh();
  }, [room.id, refresh]);

  const needKey = () => {
    const key = keyRef.current;
    if (!key) throw new Error("This secret chat isn't ready on this device.");
    return key;
  };

  const encrypt = useCallback(
    async (text: string): Promise<string> => {
      const body = await encryptText(needKey(), room.id, meId, text);
      plain.current.set(body, text);
      return body;
    },
    [room.id, meId],
  );

  /** A photo for this chat: the encrypted file to upload and the encrypted message that describes it. */
  const encryptPhoto = useCallback(
    async (blob: Blob, info: SecretPhoto): Promise<{ file: Blob; body: string }> => {
      const key = needKey();
      const [file, body] = await Promise.all([encryptBytes(key, room.id, meId, blob), encrypt(photoBody(info))]);
      return { file, body };
    },
    [room.id, meId, encrypt],
  );

  /** Downloads and decrypts one photo (also used for view-once photos, which can only be fetched once). */
  const openPhoto = useCallback(
    async (m: Message): Promise<string> => {
      const key = needKey();
      const text = plain.current.get(m.body) ?? (await decryptText(key, room.id, m.userId, m.body));
      const info = text ? parsePhotoBody(text) : null;
      const data = await (await fetchMedia(mediaUrl(m.roomId, m.id))).arrayBuffer();
      const blob = await decryptBytes(key, room.id, m.userId, data, info?.mime ?? "image/jpeg");
      if (!blob) throw new Error("This photo couldn't be decrypted.");
      return URL.createObjectURL(blob);
    },
    [room.id],
  );

  /** Decrypts any bodies (and photos) we haven't seen yet, then re-renders once. */
  const decryptAll = useCallback(
    async (messages: Message[]) => {
      const key = keyRef.current;
      if (!key) return;
      const todo = new Map<string, string>(); // body → sender
      for (const m of messages) {
        if (isEncrypted(m.body) && !plain.current.has(m.body)) todo.set(m.body, m.userId);
        if (m.replyTo && isEncrypted(m.replyTo.body) && !plain.current.has(m.replyTo.body)) todo.set(m.replyTo.body, m.replyTo.userId);
      }
      if (todo.size > 0) {
        await Promise.all(
          [...todo].map(async ([body, sender]) => {
            plain.current.set(body, await decryptText(key, room.id, sender, body));
          }),
        );
        setVersion((v) => v + 1);
      }

      // Photos: fetch + decrypt the ones on screen (not view-once: those open on tap).
      for (const m of messages) {
        const sent = !(m as { status?: string }).status && !(m as { localUrl?: string }).localUrl;
        if (m.kind !== "image" || !m.mediaId || m.deletedAt || m.meta?.viewOnce || !sent) continue;
        if (photos.current.has(m.id) || fetching.current.has(m.id)) continue;
        fetching.current.add(m.id);
        openPhoto(m).then(
          (url) => photos.current.set(m.id, url),
          () => photos.current.set(m.id, null),
        ).finally(() => {
          fetching.current.delete(m.id);
          setVersion((v) => v + 1);
        });
      }
    },
    [room.id, openPhoto],
  );

  /** The on-screen version of a message. Same object back until its text changes. */
  const readable = useCallback(
    <M extends Message>(m: M): Readable<M> => {
      if (!room.secret) return m;
      const needs = isEncrypted(m.body) || (m.replyTo && isEncrypted(m.replyTo.body)) || m.kind === "image";
      if (!needs) return m;
      const cached = views.current.get(m);
      if (cached && cached.v === version) return cached.out as Readable<M>;
      const text = isEncrypted(m.body) ? plain.current.get(m.body) : m.body;
      const reply = m.replyTo && isEncrypted(m.replyTo.body) ? plain.current.get(m.replyTo.body) : m.replyTo?.body;
      const out: Readable<M> = {
        ...m,
        body: text ?? "",
        locked: isEncrypted(m.body) && (text === null || text === undefined),
        replyTo: m.replyTo ? { ...m.replyTo, body: reply ?? "🔒", ...(m.replyTo.kind === "image" ? { body: "Photo" } : {}) } : null,
      };
      if (m.kind === "image" && !m.deletedAt) {
        const info = text ? parsePhotoBody(text) : null;
        out.body = info?.caption ?? "";
        if (info) out.meta = { ...(m.meta ?? { mime: info.mime, size: 0 }), width: info.width || undefined, height: info.height || undefined };
        const own = (m as { localUrl?: string }).localUrl;
        if (!own && !m.meta?.viewOnce) {
          const url = photos.current.get(m.id);
          if (url) out.localUrl = url;
          else out.e2eMedia = url === null ? "failed" : "loading";
        }
      }
      views.current.set(m, { v: version, out });
      return out;
    },
    [room.secret, version],
  );

  return { state, refresh, accept, encrypt, encryptPhoto, openPhoto, decryptAll, readable };
}
