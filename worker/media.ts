import { AUDIO_TYPES, IMAGE_TYPES } from "../shared/types";
import { HttpError } from "./http";

/**
 * Identifies a file by its first bytes ("magic numbers") instead of trusting the
 * client's Content-Type, so nobody can upload e.g. an HTML page disguised as a photo.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return "audio/mpeg";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/aac";
  return null;
}

export type MediaFamily = "image" | "audio";

/** Reads a raw upload body, enforcing a size limit and a whitelist of real file types. */
export async function readUpload(
  request: Request,
  family: MediaFamily,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const bytes = await readCapped(request, maxBytes);
  if (bytes.byteLength === 0) throw new HttpError(400, "The file is empty.");

  const mime = sniffMime(bytes);
  const allowed: readonly string[] = family === "image" ? IMAGE_TYPES : AUDIO_TYPES;
  if (!mime || !allowed.includes(mime)) {
    throw new HttpError(415, family === "image" ? "That isn't a supported image." : "That isn't a supported audio file.");
  }
  return { bytes, mime };
}

/**
 * Streams the body, counting bytes as they arrive, so an oversized upload is
 * refused without ever holding it all in memory. The rest of the stream is
 * drained (not buffered) so the client receives a clean 413 response.
 */
async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooBig = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) tooBig = true;
    if (!tooBig) chunks.push(value);
    // Absolute ceiling so nobody can keep a connection busy forever.
    if (total > maxBytes * 4) {
      await reader.cancel();
      break;
    }
  }
  if (tooBig) throw new HttpError(413, tooLarge(maxBytes));

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function tooLarge(max: number): string {
  return `File is too large (max ${(max / 1_000_000).toFixed(1)} MB).`;
}

/** Headers for serving user-uploaded files safely from our own origin. */
export function mediaHeaders(mime: string, cache: "immutable" | "no-store"): Record<string, string> {
  return {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    // Even if something slipped through, the browser won't run scripts from this response.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    "Cache-Control": cache === "immutable" ? "private, max-age=31536000, immutable" : "no-store",
  };
}
