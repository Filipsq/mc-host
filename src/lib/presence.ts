/**
 * Whether an admin is on the site right now, for the sleeping Steve above the help
 * bubble. Every open page polls /api/support every 30 seconds while it is visible,
 * so an admin's poll is a heartbeat. Kept in memory: the site runs as one process,
 * and after a restart admins count as online again on their next poll.
 */
const ONLINE_MS = 2 * 60_000;

const store = globalThis as unknown as { adminSeenAt?: number };

export function markAdminSeen() {
  store.adminSeenAt = Date.now();
}

export function adminOnline() {
  return store.adminSeenAt !== undefined && Date.now() - store.adminSeenAt < ONLINE_MS;
}
