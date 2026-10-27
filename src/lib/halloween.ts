// Halloween on the site (2026): an orange-and-purple look with cobwebs, spiders
// and pumpkins, and a pumpkin hunt on the home page. Whoever finds all
// HUNT_PUMPKINS gets HALLOWEEN_CODE, which takes HALLOWEEN_DISCOUNT percent off
// a new server's first payment, like a creator code (creator.ts).
// It all switches itself off when the event ends; HALLOWEEN=on/off overrides
// the dates (to try it out, or to end it early).

export const HALLOWEEN_START = new Date("2026-10-26T23:00:00Z"); // 27.10 00:00 in Poland
export const HALLOWEEN_END = new Date("2026-11-01T23:00:00Z"); // 2.11 00:00 in Poland
export const HALLOWEEN_CODE = "dynia20";
export const HALLOWEEN_DISCOUNT = 20; // percent
export const HUNT_PUMPKINS = 5;

export function halloweenOn(now = new Date()) {
  const forced = process.env.HALLOWEEN;
  if (forced === "on") return true;
  if (forced === "off") return false;
  return now >= HALLOWEEN_START && now < HALLOWEEN_END;
}

/** The Halloween code as typed ("DYNIA 20" too), while the event lasts. */
export const isHalloweenCode = (code: string) => halloweenOn() && code.toLowerCase().replace(/\s+/g, "") === HALLOWEEN_CODE;

/** A price in minor units with the Halloween discount taken off. */
export const withHalloweenDiscount = (minor: number) => Math.round((minor * (100 - HALLOWEEN_DISCOUNT)) / 100);
