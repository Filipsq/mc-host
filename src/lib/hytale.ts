import "server-only";
import { db } from "./db";

// The admin's Hytale account, which signs in every Hytale server (agent/hytale.go).
// Hytale's guide for hosting providers (support.hytale.com, "Server Provider
// Authentication"): sign in once with the OAuth device flow, keep the refresh
// token (it's rotated on every use and lasts 30 days unused), and make a
// game session for each server; the server renews its own session after
// that. The downloader that fetches the game's files is a separate OAuth
// client with its own sign-in. One account runs up to 500 servers at once.

export type HytaleAuthKind = "server" | "downloader";

const OAUTH = "https://oauth.accounts.hytale.com/oauth2";
const CLIENTS: Record<HytaleAuthKind, { clientId: string; scope: string }> = {
  server: { clientId: "hytale-server", scope: "openid offline auth:server" },
  downloader: { clientId: "hytale-downloader", scope: "openid offline auth:downloader" },
};

/** What the agent gets for a Hytale server: all empty when no account is connected. */
export type HytaleSpec = {
  sessionToken: string;
  identityToken: string;
  ownerUuid: string;
  downloaderAccess: string;
  downloaderRefresh: string;
  downloaderExpires: number;
};

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as TokenAnswer;
}

/** Starts a sign-in: the code and the page the admin types it on. */
export async function startDeviceLogin(kind: HytaleAuthKind) {
  const { clientId, scope } = CLIENTS[kind];
  const res = await fetch(`${OAUTH}/device/auth`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Hytale device login: HTTP ${res.status}`);
  const d = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number };
  const data = {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verifyUrl: d.verification_uri_complete ?? d.verification_uri,
    deviceUntil: new Date(Date.now() + d.expires_in * 1000),
  };
  await db.hytaleAuth.upsert({ where: { id: kind }, create: { id: kind, ...data }, update: data });
}

/** Asks Hytale whether the admin finished signing in. "done", "pending" or an error to show. */
export async function pollDeviceLogin(kind: HytaleAuthKind): Promise<"done" | "pending" | "expired" | "failed"> {
  const row = await db.hytaleAuth.findUnique({ where: { id: kind } });
  if (!row?.deviceCode || !row.deviceUntil) return "failed";
  if (row.deviceUntil < new Date()) {
    await clearDevice(kind);
    return "expired";
  }
  const t = await tokenRequest({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: row.deviceCode,
    client_id: CLIENTS[kind].clientId,
  });
  if (t.error === "authorization_pending" || t.error === "slow_down") return "pending";
  if (!t.access_token || !t.refresh_token) {
    console.error("hytale device login failed", kind, t.error, t.error_description);
    await clearDevice(kind);
    return "failed";
  }
  const profile = kind === "server" ? await gameProfile(t.access_token) : null;
  await db.hytaleAuth.update({
    where: { id: kind },
    data: {
      refreshToken: t.refresh_token,
      accessToken: t.access_token,
      accessUntil: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
      profileUuid: profile?.uuid ?? null,
      profileName: profile?.username ?? null,
      deviceCode: null,
      userCode: null,
      verifyUrl: null,
      deviceUntil: null,
    },
  });
  return "done";
}

async function clearDevice(kind: HytaleAuthKind) {
  await db.hytaleAuth.update({ where: { id: kind }, data: { deviceCode: null, userCode: null, verifyUrl: null, deviceUntil: null } });
}

export async function disconnect(kind: HytaleAuthKind) {
  await db.hytaleAuth.deleteMany({ where: { id: kind } });
}

/** The account's first game profile: servers run as it. */
async function gameProfile(accessToken: string) {
  const res = await fetch("https://account-data.hytale.com/my-account/get-profiles", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Hytale profiles: HTTP ${res.status}`);
  const body = (await res.json()) as { profiles?: { uuid: string; username: string }[] };
  return body.profiles?.[0] ?? null;
}

// Two refreshes at once would each spend the same refresh token; the second
// then fails and the sign-in is lost. One at a time per kind.
const refreshing = new Map<HytaleAuthKind, Promise<{ accessToken: string; refreshToken: string; until: Date } | null>>();

/** A valid access token (refreshed if it has under 5 minutes left), or null if not signed in. */
export function accessToken(kind: HytaleAuthKind) {
  const running = refreshing.get(kind);
  if (running) return running;
  const p = (async () => {
    const row = await db.hytaleAuth.findUnique({ where: { id: kind } });
    if (!row?.refreshToken) return null;
    if (row.accessToken && row.accessUntil && row.accessUntil.getTime() > Date.now() + 5 * 60_000) {
      return { accessToken: row.accessToken, refreshToken: row.refreshToken, until: row.accessUntil };
    }
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken, client_id: CLIENTS[kind].clientId });
    if (!t.access_token) {
      console.error("hytale refresh failed", kind, t.error, t.error_description);
      if (t.error === "invalid_grant") await db.hytaleAuth.update({ where: { id: kind }, data: { refreshToken: null, accessToken: null } });
      return null;
    }
    const until = new Date(Date.now() + (t.expires_in ?? 3600) * 1000);
    const refreshToken = t.refresh_token ?? row.refreshToken;
    await db.hytaleAuth.update({ where: { id: kind }, data: { accessToken: t.access_token, accessUntil: until, refreshToken } });
    return { accessToken: t.access_token, refreshToken, until };
  })().finally(() => refreshing.delete(kind));
  refreshing.set(kind, p);
  return p;
}

/** A new game session for one server; null without a connected account. */
async function gameSession() {
  const [token, row] = await Promise.all([accessToken("server"), db.hytaleAuth.findUnique({ where: { id: "server" } })]);
  if (!token || !row?.profileUuid) return null;
  const res = await fetch("https://sessions.hytale.com/game-session/new", {
    method: "POST",
    headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ uuid: row.profileUuid }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // 403: the account's 500 servers are all in use.
    console.error("hytale game session failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const s = (await res.json()) as { sessionToken: string; identityToken: string };
  return { ...s, ownerUuid: row.profileUuid };
}

/**
 * The sign-ins a Hytale container starts with. Never throws: without them the
 * server still starts, and says in its console what's missing.
 */
export async function hytaleSpec(): Promise<HytaleSpec> {
  const [session, dl] = await Promise.all([
    gameSession().catch((err) => (console.error("hytale session", err), null)),
    accessToken("downloader").catch((err) => (console.error("hytale downloader", err), null)),
  ]);
  return {
    sessionToken: session?.sessionToken ?? "",
    identityToken: session?.identityToken ?? "",
    ownerUuid: session?.ownerUuid ?? "",
    downloaderAccess: dl?.accessToken ?? "",
    downloaderRefresh: dl?.refreshToken ?? "",
    downloaderExpires: dl ? Math.floor(dl.until.getTime() / 1000) : 0,
  };
}

/** What the admin page shows. */
export async function hytaleStatus() {
  const rows = await db.hytaleAuth.findMany();
  const one = (kind: HytaleAuthKind) => {
    const r = rows.find((x) => x.id === kind);
    return {
      connected: !!r?.refreshToken,
      profileName: r?.profileName ?? null,
      pending: r?.deviceCode && r.deviceUntil && r.deviceUntil > new Date() ? { code: r.userCode ?? "", url: r.verifyUrl ?? "" } : null,
      updatedAt: r?.updatedAt ?? null,
    };
  };
  return { server: one("server"), downloader: one("downloader") };
}

/** Keeps the sign-ins alive: a refresh token unused for 30 days stops working. Called daily from billing. */
export async function keepHytaleAlive() {
  for (const kind of ["server", "downloader"] as const) {
    const row = await db.hytaleAuth.findUnique({ where: { id: kind } });
    if (!row?.refreshToken || (row.accessUntil && row.accessUntil.getTime() > Date.now() - 7 * 24 * 3600_000)) continue;
    await accessToken(kind).catch((err) => console.error("hytale keep-alive", kind, err));
  }
}
