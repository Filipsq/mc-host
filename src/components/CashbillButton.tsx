import type { Messages } from "@/i18n/messages";
import PayBadges from "./PayBadges";

/**
 * The BLIK, bank transfer and paysafecard pay button: submits its form with method=cashbill,
 * which the server sends to CashBill (cashbill.ts). Cards go through the main
 * button (method=card, Stripe). Shown only where CashBill is set up.
 */
export default function CashbillButton({ t, disabled }: { t: Messages["billing"]; disabled?: boolean }) {
  return (
    <button type="submit" className="secondary pay-button" name="method" value="cashbill" disabled={disabled}>
      <span className="pay-label">{t.payCashbill}</span>
      <PayBadges method="cashbill" />
    </button>
  );
}
