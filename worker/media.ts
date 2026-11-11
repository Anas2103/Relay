import {
  AUDIO_TYPES,
  BLOCKED_EXTENSIONS,
  fileExtension,
  IMAGE_TYPES,
  LIMITS,
  VIDEO_TYPES,
  type MediaKind,
} from "../shared/types";
import { HttpError } from "./http";

type Container = "jpeg" | "png" | "gif" | "webp" | "matroska" | "ogg" | "mp4" | "quicktime" | "mp3" | "aac";

/**
 * Identifies a file by its first bytes ("magic numbers") instead of trusting the
 * client's Content-Type, so nobody can upload e.g. an HTML page disguised as a photo.
 */
function sniffContainer(b: Uint8Array): Container | null {
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "png";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "matroska"; // WebM
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(4, 4) === "ftyp") return ascii(8, 4) === "qt  " ? "quicktime" : "mp4";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return "mp3";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac";
  return null;
}

/** Maps a detected container to a MIME type for the requested kind, or null if it doesn't fit. */
function mimeFor(kind: MediaKind, container: Container | null): string | null {
  if (!container) return null;
  const map: Record<Exclude<MediaKind, "file">, Partial<Record<Container, string>>> = {
    image: { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" },
    voice: { matroska: "audio/webm", ogg: "audio/ogg", mp4: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac" },
    video: { mp4: "video/mp4", matroska: "video/webm", quicktime: "video/quicktime" },
  };
  if (kind === "file") return null;
  const mime = map[kind][container] ?? null;
  const allowed: readonly string[] = kind === "image" ? IMAGE_TYPES : kind === "voice" ? AUDIO_TYPES : VIDEO_TYPES;
  return mime && allowed.includes(mime) ? mime : null;
}

/** Strips paths, control characters and anything odd from an uploaded file's name. */
export function cleanFileName(raw: string | null): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.fileNameMax);
  return cleaned || "file";
}

/** Reads a raw upload body, enforcing a size limit and (for media) a whitelist of real file types. */
export async function readUpload(
  request: Request,
  kind: MediaKind,
  maxBytes: number,
  fileName?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (kind === "file" && fileName && BLOCKED_EXTENSIONS.includes(fileExtension(fileName))) {
    throw new HttpError(415, "For safety, programs and scripts can't be sent.");
  }

  const bytes = await readCapped(request, maxBytes);
  if (bytes.byteLength === 0) throw new HttpError(400, "The file is empty.");

  if (kind === "file") {
    // Documents can be anything; they're always served as downloads, never opened inline.
    return { bytes, mime: "application/octet-stream" };
  }
  const mime = mimeFor(kind, sniffContainer(bytes));
  if (!mime) {
    const what = { image: "an image", voice: "a supported audio file", video: "a supported video (MP4, WebM or MOV)" }[kind];
    throw new HttpError(415, `That isn't ${what}.`);
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
  if (tooBig) throw new HttpError(413, `File is too large (max ${Math.round(maxBytes / 1_000_000)} MB).`);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Headers for serving user-uploaded files safely from our own origin. */
export function mediaHeaders(
  mime: string,
  cache: "immutable" | "no-store",
  download?: string,
): Record<string, string> {
  return {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    // Even if something slipped through, the browser won't run scripts from this response.
    "Content-Security-Policy": "default-src 'none'; media-src 'self'; sandbox",
    "Content-Disposition": download
      ? `attachment; filename="${download.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(download)}`
      : "inline",
    "Cache-Control": cache === "immutable" ? "private, max-age=31536000, immutable" : "no-store",
    "Accept-Ranges": "bytes",
  };
}

/**
 * Parses an HTTP Range header. iPhones refuse to play audio/video unless the
 * server can return byte ranges, and ranges make video seeking instant.
 * Returns null for "whole file", or "invalid" for an unsatisfiable range.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2])); // "bytes=-500" = the last 500 bytes
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
