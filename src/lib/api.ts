import type {
  AdminStats,
  AdminUser,
  AdminUserUpdate,
  AuditEntry,
  GalleryTab,
  MediaKind,
  Me,
  Message,
  MessagePage,
  Profile,
  Role,
  Room,
  Settings,
  User,
} from "../../shared/types";

/** Fired when the session is no longer valid (signed out elsewhere, suspended, deleted). */
export const UNAUTHORIZED_EVENT = "relay:unauthorized";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; raw?: Blob; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.raw
        ? { "Content-Type": options.raw.type || "application/octet-stream" }
        : options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/me" && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong.");
  return data as T;
}

export interface Cursor {
  createdAt: number;
  id: string;
}

/**
 * Uploads a file with progress reporting (fetch can't report upload progress,
 * which matters for a 20 MB video on mobile data).
 */
function uploadMedia(
  roomId: string,
  kind: MediaKind,
  file: Blob,
  opts: { name?: string; onProgress?: (fraction: number) => void } = {},
): Promise<{ mediaId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const name = opts.name ? `&name=${encodeURIComponent(opts.name)}` : "";
    xhr.open("POST", `/api/rooms/${roomId}/media?kind=${kind}${name}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: { mediaId?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      if (xhr.status >= 200 && xhr.status < 300 && data.mediaId) resolve({ mediaId: data.mediaId });
      else reject(new ApiError(xhr.status, data.error ?? "Upload failed."));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection."));
    xhr.send(file);
  });
}

export function avatarUrl(user: Pick<User, "id" | "avatarVersion">): string | null {
  return user.avatarVersion ? `/api/users/${user.id}/avatar?v=${user.avatarVersion}` : null;
}

export function mediaUrl(roomId: string, messageId: string): string {
  return `/api/rooms/${roomId}/messages/${messageId}/media`;
}

/** Fetches a file as a Blob, surfacing API errors (e.g. "already opened"). */
export async function fetchMedia(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? "Couldn't load this file.");
  }
  return res.blob();
}

export const api = {
  me: () => request<{ user: Me }>("/api/me"),
  register: (username: string, password: string, displayName: string) =>
    request<{ user: Me }>("/api/auth/register", { method: "POST", body: { username, password, displayName } }),
  login: (username: string, password: string) =>
    request<{ user: Me }>("/api/auth/login", { method: "POST", body: { username, password } }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: {} }),

  searchUsers: (q: string) => request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  profile: (id: string) => request<{ profile: Profile }>(`/api/users/${id}`),

  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  openDm: (username: string) => request<{ room: Room }>("/api/rooms/dm", { method: "POST", body: { username } }),
  /** Latest page, or older (`before`), newer (`after`), or a window around one message (`around`). */
  messages: (
    roomId: string,
    opts: { before?: Cursor; after?: Cursor; around?: string } = {},
  ) => {
    const qs = opts.around
      ? `?around=${encodeURIComponent(opts.around)}`
      : opts.after
        ? `?after=${opts.after.createdAt}&afterId=${encodeURIComponent(opts.after.id)}`
        : opts.before
          ? `?before=${opts.before.createdAt}&beforeId=${encodeURIComponent(opts.before.id)}`
          : "";
    return request<MessagePage>(`/api/rooms/${roomId}/messages${qs}`);
  },
  search: (roomId: string, q: string) =>
    request<{ messages: Message[] }>(`/api/rooms/${roomId}/search?q=${encodeURIComponent(q)}`),
  gallery: (roomId: string, tab: GalleryTab, before?: Cursor) =>
    request<{ messages: Message[]; hasMore: boolean }>(
      `/api/rooms/${roomId}/gallery?tab=${tab}${before ? `&before=${before.createdAt}&beforeId=${encodeURIComponent(before.id)}` : ""}`,
    ),
  uploadMedia,
  iceServers: () => request<{ iceServers: RTCIceServer[]; relay: boolean }>("/api/calls/ice"),

  account: {
    update: (data: { displayName?: string; bio?: string; settings?: Partial<Settings> }) =>
      request<{ user: Me }>("/api/account", { method: "PATCH", body: data }),
    uploadAvatar: (file: Blob) => request<{ user: Me }>("/api/account/avatar", { method: "PUT", raw: file }),
    removeAvatar: () => request<{ user: Me }>("/api/account/avatar", { method: "DELETE", body: {} }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>("/api/account/password", { method: "POST", body: { currentPassword, newPassword } }),
  },

  admin: {
    stats: () => request<{ stats: AdminStats }>("/api/admin/stats"),
    users: (q = "") => request<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
    createUser: (data: { username: string; displayName: string; password: string; role: Role }) =>
      request<{ user: AdminUser }>("/api/admin/users", { method: "POST", body: data }),
    updateUser: (id: string, data: AdminUserUpdate) =>
      request<{ user: AdminUser }>(`/api/admin/users/${id}`, { method: "PATCH", body: data }),
    signOutEverywhere: (id: string) =>
      request<{ user: AdminUser }>(`/api/admin/users/${id}/sessions`, { method: "DELETE", body: {} }),
    deleteUser: (id: string) => request<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE", body: {} }),
    audit: () => request<{ entries: AuditEntry[] }>("/api/admin/audit"),
  },
};
