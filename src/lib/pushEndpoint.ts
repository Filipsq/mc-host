// The server posts notifications to the address a browser gives it, so only
// the browsers' own push services are accepted, never an address of ours.
const PUSH_HOSTS = ["googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"];

/** Remembers which subscription is this browser's, so logging out can remove it. */
export const PUSH_COOKIE = "push";

export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
