export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export async function readJson<T>(request: Request): Promise<T> {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    throw new HttpError(415, "Expected a JSON body.");
  }
  const text = await request.text();
  if (text.length > 16_000) throw new HttpError(413, "Request is too large.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

/** Blocks cross-site requests (CSRF / cross-site WebSocket hijacking). */
export function assertSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get("Origin");
  if (origin === null) return; // non-browser clients and same-origin GETs
  if (origin !== url.origin) throw new HttpError(403, "Cross-origin request blocked.");
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}
