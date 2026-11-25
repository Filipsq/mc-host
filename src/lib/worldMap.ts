import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// The world map in emails ("Twój świat zniknie za 3 dni"): mail apps load
// pictures without the owner's session, so the link carries its own signature
// and an end date instead (src/app/api/mapa/[id]/route.ts).

const sign = (id: string, expires: number) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`world-map:${id}:${expires}`).digest("base64url");

export function worldMapLink(app: string, id: string, until: Date) {
  const expires = Math.floor(until.getTime() / 1000);
  return `${app}/api/mapa/${encodeURIComponent(id)}?e=${expires}&s=${sign(id, expires)}`;
}

export function validWorldMapLink(id: string, e: string | null, s: string | null) {
  const expires = Number(e);
  if (!s || !Number.isInteger(expires) || expires * 1000 < Date.now()) return false;
  const want = Buffer.from(sign(id, expires));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}
