import LinkedText from "@/components/legal/LinkedText";
import type { Messages } from "@/i18n/messages";

// A paid server starts right after payment, so consumers must ask for that
// before the 14-day withdrawal period ends (art. 21 of the Consumer Rights Act).
export default function PaymentConsent({ legal }: { legal: Messages["legal"] }) {
  return (
    <>
      <label className="check">
        <input name="startNow" type="checkbox" required />
        <span>{legal.startNow}</span>
      </label>
      <p className="muted small">
        <LinkedText text={legal.payTerms} href="/regulamin" label={legal.termsLinkGenitive} newTab />
      </p>
    </>
  );
}
