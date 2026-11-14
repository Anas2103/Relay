import type {
  AdminReport,
  AdminRoom,
  GroupBan,
  ReportReason,
  BlockedUser,
  AdminStats,
  AdminUser,
  AdminUserUpdate,
  AuditEntry,
  GalleryTab,
  GroupMember,
  InvitePreview,
  LinkPreview,
  SecurityOverview,
  SiteSettings,
  MediaKind,
  Me,
  Message,
  MessagePage,
  Profile,
  Role,
  Room,
  SecretInfo,
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

export function groupPhotoUrl(room: { id: string; avatarVersion: number | null }): string | null {
  return room.avatarVersion ? `/api/rooms/${room.id}/avatar?v=${room.avatarVersion}` : null;
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
  /** Returns the user, or a challenge when two-step verification is on. */
  login: (username: string, password: string) =>
    request<{ user: Me } | { twoFactor: true; challenge: string }>("/api/auth/login", { method: "POST", body: { username, password } }),
  verifyLogin: (challenge: string, code: string) =>
    request<{ user: Me }>("/api/auth/2fa", { method: "POST", body: { challenge, code } }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: {} }),

  searchUsers: (q: string) => request<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  blockUser: (id: string) => request<{ ok: true }>(`/api/users/${id}/block`, { method: "POST", body: {} }),
  unblockUser: (id: string) => request<{ ok: true }>(`/api/users/${id}/unblock`, { method: "POST", body: {} }),
  blocked: () => request<{ blocked: BlockedUser[] }>("/api/blocks"),
  profile: (id: string) => request<{ profile: Profile }>(`/api/users/${id}`),

  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  openDm: (username: string) => request<{ room: Room }>("/api/rooms/dm", { method: "POST", body: { username } }),
  acceptRequest: (roomId: string) => request<{ room: Room }>(`/api/rooms/${roomId}/accept`, { method: "POST", body: {} }),
  declineRequest: (roomId: string) => request<{ ok: true }>(`/api/rooms/${roomId}/decline`, { method: "POST", body: {} }),
  openSaved: () => request<{ room: Room }>("/api/rooms/saved", { method: "POST", body: {} }),
  deleteChat: (roomId: string) => request<{ ok: true }>(`/api/rooms/${roomId}`, { method: "DELETE", body: {} }),
  updatePrefs: (roomId: string, data: { pinned?: boolean; archived?: boolean; mutedUntil?: number | null }) =>
    request<{ room: Room }>(`/api/rooms/${roomId}/prefs`, { method: "PATCH", body: data }),
  startSecret: (dmId: string, key: { deviceId: string; publicKey: string }) =>
    request<{ room: Room; existing: boolean }>(`/api/rooms/${dmId}/secret`, { method: "POST", body: key }),
  acceptSecret: (roomId: string, key: { deviceId: string; publicKey: string }) =>
    request<{ room: Room }>(`/api/rooms/${roomId}/secret/accept`, { method: "POST", body: key }),
  secretInfo: (roomId: string) => request<{ secret: SecretInfo }>(`/api/rooms/${roomId}/secret`),
  exportUrl: "/api/account/export",
  createGroup: (name: string, memberIds: string[]) => request<{ room: Room }>("/api/groups", { method: "POST", body: { name, memberIds } }),
  updateRoom: (roomId: string, data: { name?: string; disappearMs?: number | null; adminsOnly?: boolean; slowModeMs?: number }) =>
    request<{ room: Room }>(`/api/rooms/${roomId}`, { method: "PATCH", body: data }),
  setInvite: (roomId: string, on: boolean) =>
    request<{ room: Room }>(`/api/rooms/${roomId}/invite`, { method: on ? "POST" : "DELETE", body: {} }),
  invite: (code: string) => request<{ invite: InvitePreview }>(`/api/invite/${encodeURIComponent(code)}`),
  joinInvite: (code: string) => request<{ room: Room }>(`/api/invite/${encodeURIComponent(code)}`, { method: "POST", body: {} }),
  members: (roomId: string) => request<{ members: GroupMember[] }>(`/api/rooms/${roomId}/members`),
  addMembers: (roomId: string, userIds: string[]) =>
    request<{ added: number }>(`/api/rooms/${roomId}/members`, { method: "POST", body: { userIds } }),
  removeMember: (roomId: string, userId: string, ban = false) =>
    request<{ ok: true }>(`/api/rooms/${roomId}/members/${userId}${ban ? "?ban=1" : ""}`, { method: "DELETE", body: {} }),
  bans: (roomId: string) => request<{ bans: GroupBan[] }>(`/api/rooms/${roomId}/bans`),
  unban: (roomId: string, userId: string) => request<{ ok: true }>(`/api/rooms/${roomId}/bans/${userId}`, { method: "DELETE", body: {} }),
  setGroupPhoto: (roomId: string, file: Blob) => request<{ ok: true }>(`/api/rooms/${roomId}/avatar`, { method: "PUT", raw: file }),
  removeGroupPhoto: (roomId: string) => request<{ ok: true }>(`/api/rooms/${roomId}/avatar`, { method: "DELETE", body: {} }),
  searchEverywhere: (q: string, signal?: AbortSignal) => request<{ messages: Message[] }>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),
  report: (data: { reason: ReportReason; details?: string; userId?: string; roomId?: string; messageId?: string; evidence?: string }) =>
    request<{ ok: true }>("/api/reports", { method: "POST", body: data }),
  setMemberRole: (roomId: string, userId: string, role: "member" | "admin") =>
    request<{ ok: true }>(`/api/rooms/${roomId}/members/${userId}`, { method: "PATCH", body: { role } }),
  pinned: (roomId: string) => request<{ messages: Message[] }>(`/api/rooms/${roomId}/pinned`),
  starred: (roomId: string) => request<{ messages: Message[] }>(`/api/rooms/${roomId}/starred`),
  star: (roomId: string, messageId: string, on: boolean) =>
    request<{ ok: true }>(`/api/rooms/${roomId}/messages/${messageId}/star`, { method: on ? "POST" : "DELETE", body: {} }),
  forwardMedia: (targetRoomId: string, fromRoomId: string, messageId: string) =>
    request<{ mediaId: string; kind: Message["kind"]; body: string; meta: NonNullable<Message["meta"]> }>(
      `/api/rooms/${targetRoomId}/forward`,
      { method: "POST", body: { fromRoomId, messageId } },
    ),
  linkPreview: (url: string) => request<{ preview: LinkPreview | null }>(`/api/link-preview?url=${encodeURIComponent(url)}`),
  site: () => request<{ site: SiteSettings }>("/api/site"),
  pushKey: () => request<{ key: string | null }>("/api/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<{ ok: true }>("/api/push/subscribe", { method: "POST", body: sub }),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>("/api/push/unsubscribe", { method: "POST", body: { endpoint } }),
  deleteAccount: (password: string) => request<{ ok: true }>("/api/account", { method: "DELETE", body: { password } }),
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
    update: (data: { displayName?: string; bio?: string; statusText?: string; settings?: Partial<Settings> }) =>
      request<{ user: Me }>("/api/account", { method: "PATCH", body: data }),
    uploadAvatar: (file: Blob) => request<{ user: Me }>("/api/account/avatar", { method: "PUT", raw: file }),
    removeAvatar: () => request<{ user: Me }>("/api/account/avatar", { method: "DELETE", body: {} }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>("/api/account/password", { method: "POST", body: { currentPassword, newPassword } }),
    security: () => request<{ security: SecurityOverview }>("/api/account/security"),
    setSessionIdle: (sessionIdleDays: number) =>
      request<{ security: SecurityOverview }>("/api/account/security", { method: "PATCH", body: { sessionIdleDays } }),
    revokeSession: (id: string) => request<{ security: SecurityOverview }>(`/api/account/sessions/${id}`, { method: "DELETE", body: {} }),
    revokeOtherSessions: () => request<{ security: SecurityOverview }>("/api/account/sessions", { method: "DELETE", body: {} }),
    setup2fa: (password: string) => request<{ secret: string; uri: string }>("/api/account/2fa/setup", { method: "POST", body: { password } }),
    enable2fa: (code: string) => request<{ recoveryCodes: string[]; user: Me }>("/api/account/2fa/enable", { method: "POST", body: { code } }),
    disable2fa: (password: string) => request<{ user: Me }>("/api/account/2fa/disable", { method: "POST", body: { password } }),
    newRecoveryCodes: (password: string) =>
      request<{ recoveryCodes: string[] }>("/api/account/2fa/recovery", { method: "POST", body: { password } }),
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
    reports: (status: "open" | "closed" = "open") => request<{ reports: AdminReport[]; open: number }>(`/api/admin/reports?status=${status}`),
    resolveReport: (id: string, status: "resolved" | "dismissed") =>
      request<{ ok: true }>(`/api/admin/reports/${id}`, { method: "PATCH", body: { status } }),
    // Owner only (Grimm)
    rooms: (q = "") => request<{ rooms: AdminRoom[] }>(`/api/admin/rooms?q=${encodeURIComponent(q)}`),
    roomMessages: (roomId: string, before?: Cursor) =>
      request<{ messages: Message[]; hasMore: boolean }>(
        `/api/admin/rooms/${roomId}/messages${before ? `?before=${before.createdAt}&beforeId=${encodeURIComponent(before.id)}` : ""}`,
      ),
    mediaUrl: (roomId: string, messageId: string) => `/api/admin/rooms/${roomId}/messages/${messageId}/media`,
    deleteMessage: (roomId: string, messageId: string) =>
      request<{ ok: true }>(`/api/admin/rooms/${roomId}/messages/${messageId}`, { method: "DELETE", body: {} }),
    deleteRoom: (roomId: string) => request<{ ok: true }>(`/api/admin/rooms/${roomId}`, { method: "DELETE", body: {} }),
    exportUrl: (roomId: string) => `/api/admin/rooms/${roomId}/export`,
    site: () => request<{ site: SiteSettings }>("/api/admin/site"),
    updateSite: (data: { announcement?: string; registrationOpen?: boolean; maintenance?: boolean }) =>
      request<{ site: SiteSettings }>("/api/admin/site", { method: "PUT", body: data }),
  },
};
