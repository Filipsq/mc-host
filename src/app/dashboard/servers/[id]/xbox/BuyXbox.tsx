"use client";

import { useActionState } from "react";
import { buyXboxAction } from "../../actions";
import PaymentConsent from "@/components/PaymentConsent";
import PayBadges from "@/components/PayBadges";
import { format, type Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  price: string;
  days: number;
  paysafecard: boolean;
  again: boolean; // already paid for: this adds more days
  t: Messages["xbox"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  errors: Messages["server"]["errors"];
};

/** Buys console joining for a free server, for `days` at a time. */
export default function BuyXbox({ serverId, price, days, paysafecard, again, t, billing, legal, errors }: Props) {
  const [state, action, pending] = useActionState(buyXboxAction.bind(null, serverId), {});
  return (
    <form action={action} className="stack">
      <p>
        <strong>{format(again ? t.buyMore : t.buyTitle, { price, days })}</strong>
      </p>
      <p className="muted small">{billing.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" disabled={pending}>
          <span className="pay-label">{pending ? billing.redirecting : t.buy}</span>
          <PayBadges method="stripe" />
        </button>
        {paysafecard && (
          <button type="submit" className="secondary pay-button" name="method" value="paysafecard" disabled={pending}>
            <span className="pay-label">{billing.paysafecard}</span>
            <PayBadges method="paysafecard" />
          </button>
        )}
      </div>
    </form>
  );
}
