// Black Friday 2026: BLACK_FRIDAY_DISCOUNT percent off every plan bought or
// extended (a new server, or more days for one), with a bar on every page and
// the sale price on the price lists. It takes the place of the other codes and
// offers (creator, renewal, start offer): stacked with them some plans would
// cost us more than they bring. Gifts, upgrades and add-ons bought alone keep
// their price. It all switches itself off when the sale ends; BLACK_FRIDAY=on/off
// overrides the dates (to try it out, or to end it early).

export const BLACK_FRIDAY_START = new Date("2026-11-26T23:00:00Z"); // 27.11 00:00 in Poland
export const BLACK_FRIDAY_END = new Date("2026-11-27T23:00:00Z"); // 28.11 00:00 in Poland
export const BLACK_FRIDAY_DISCOUNT = 30; // percent
/** Payment.promoCode of a payment made at the sale price. */
export const BLACK_FRIDAY_CODE = "blackfriday";

export function blackFridayOn(now = new Date()) {
  const forced = process.env.BLACK_FRIDAY;
  if (forced === "on") return true;
  if (forced === "off") return false;
  return now >= BLACK_FRIDAY_START && now < BLACK_FRIDAY_END;
}

/** A price in minor units with the sale taken off. */
export const withBlackFridayDiscount = (minor: number, percent = BLACK_FRIDAY_DISCOUNT) => Math.round((minor * (100 - percent)) / 100);

/** A price (in złoty, euro...) with the sale taken off, the same way checkout does it. */
export const salePrice = (amount: number, percent = BLACK_FRIDAY_DISCOUNT) => withBlackFridayDiscount(Math.round(amount * 100), percent) / 100;
