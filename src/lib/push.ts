import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { siteUrl } from "./site";

// Phone and browser notifications (Web Push), sent next to the emails about
// plans and help chat replies. They reach users who turned them on in the
// panel; on an iPhone that only works in the app added to the home screen.
// Without VAPID keys in deploy/.env (setup.sh makes them) nothing is sent.

export type Push = { title: string; body: string; url: string };

/** The key browsers subscribe with, or null when notifications are off. */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null;
}

/** Sends to every device of these users that turned notifications on. Never throws. */
export async function sendPush(userIds: string[], push: Push): Promise<void> {
  const publicKey = pushPublicKey();
  if (!publicKey || userIds.length === 0) return;
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  const payload = JSON.stringify({ ...push, url: new URL(push.url, siteUrl()).pathname });
  // Push services want a way to reach the sender: the site, or a stand-in when testing without HTTPS.
  const subject = siteUrl().startsWith("https:") ? siteUrl() : "mailto:admin@localhost";
  const vapidDetails = { subject, publicKey, privateKey: process.env.VAPID_PRIVATE_KEY! };
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails, TTL: 24 * 60 * 60, timeout: 10_000 },
        );
      } catch (err) {
        // 404/410: the user turned notifications off in the browser or removed the app.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.pushSubscription.deleteMany({ where: { id: sub.id } });
        } else {
          console.error(`[push] sending to ${new URL(sub.endpoint).host} failed:`, status ?? err);
        }
      }
    }),
  );
}
