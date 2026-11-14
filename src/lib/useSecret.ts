import { useCallback, useEffect, useRef, useState } from "react";
import { isEncrypted, type Message, type Room } from "../../shared/types";
import { api, ApiError } from "./api";
import { createDeviceKey, decryptText, encryptText, forgetKey, secretState, type SecretState } from "./e2e";

/** A message as shown on screen: encrypted bodies replaced by their text. */
export type Readable<M extends Message> = M & { locked?: boolean };

/**
 * Everything a secret chat needs on this device: its state, encrypting before
 * sending, and decrypting what's shown (results are cached, so each message is
 * decrypted once and bubbles keep the same object between renders).
 */
export function useSecret(room: Room, meId: string) {
  const [state, setState] = useState<SecretState>(room.secret ? { kind: "loading" } : { kind: "unsupported" });
  const [version, setVersion] = useState(0);
  const plain = useRef(new Map<string, string | null>());
  const views = useRef(new WeakMap<Message, { v: number; out: Message }>());
  const keyRef = useRef<CryptoKey | null>(null);

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

  const encrypt = useCallback(
    async (text: string): Promise<string> => {
      const key = keyRef.current;
      if (!key) throw new Error("This secret chat isn't ready on this device.");
      const body = await encryptText(key, room.id, text);
      plain.current.set(body, text);
      return body;
    },
    [room.id],
  );

  /** Decrypts any bodies we haven't seen yet, then re-renders once. */
  const decryptAll = useCallback(
    async (messages: Message[]) => {
      const key = keyRef.current;
      if (!key) return;
      const todo = new Set<string>();
      for (const m of messages) {
        if (isEncrypted(m.body) && !plain.current.has(m.body)) todo.add(m.body);
        if (m.replyTo && isEncrypted(m.replyTo.body) && !plain.current.has(m.replyTo.body)) todo.add(m.replyTo.body);
      }
      if (todo.size === 0) return;
      await Promise.all(
        [...todo].map(async (body) => {
          plain.current.set(body, await decryptText(key, room.id, body));
        }),
      );
      setVersion((v) => v + 1);
    },
    [room.id],
  );

  /** The on-screen version of a message. Same object back until its text changes. */
  const readable = useCallback(
    <M extends Message>(m: M): Readable<M> => {
      if (!room.secret) return m;
      const needs = isEncrypted(m.body) || (m.replyTo && isEncrypted(m.replyTo.body));
      if (!needs) return m;
      const cached = views.current.get(m);
      if (cached && cached.v === version) return cached.out as Readable<M>;
      const text = isEncrypted(m.body) ? plain.current.get(m.body) : m.body;
      const reply = m.replyTo && isEncrypted(m.replyTo.body) ? plain.current.get(m.replyTo.body) : m.replyTo?.body;
      const out: Readable<M> = {
        ...m,
        body: text ?? "",
        locked: isEncrypted(m.body) && (text === null || text === undefined),
        replyTo: m.replyTo ? { ...m.replyTo, body: reply ?? "🔒" } : null,
      };
      views.current.set(m, { v: version, out });
      return out;
    },
    [room.secret, version],
  );

  return { state, refresh, accept, encrypt, decryptAll, readable };
}
