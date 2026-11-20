import { createHash, timingSafeEqual } from "node:crypto";

/** Compares a given secret with the expected one in constant time, so response timing can't reveal it letter by letter. */
export function sameSecret(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
