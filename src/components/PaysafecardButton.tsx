"use client";

import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import PayBadges from "./PayBadges";

/** Asks the help bubble (HelpBubble) to open the admin chat with `text` typed in. */
export const HELP_OPEN_EVENT = "help-open";
export type HelpOpenDetail = { text?: string };

/**
 * The second pay button. paysafecard doesn't work on the site yet, so instead
 * of paying it opens the chat with the admin, a message about paying with
 * paysafecard already written. Not a submit button: it never starts a payment.
 */
export default function PaysafecardButton({ t, what, disabled }: { t: Messages["billing"]; what: string; disabled?: boolean }) {
  const router = useRouter();
  const open = () => {
    const text = t.paysafecardDraft.replace("{what}", what);
    const event = new CustomEvent<HelpOpenDetail>(HELP_OPEN_EVENT, { detail: { text }, cancelable: true });
    window.dispatchEvent(event);
    // No bubble on this page (or an admin's): the full chat page instead.
    if (!event.defaultPrevented) router.push(`/dashboard/support?text=${encodeURIComponent(text)}`);
  };
  return (
    <button type="button" className="secondary pay-button psc-button" onClick={open} disabled={disabled}>
      <span className="psc-label">
        <span className="pay-label">{t.paysafecard}</span>
        <span className="psc-note">{t.paysafecardSoon}</span>
      </span>
      <PayBadges method="paysafecard" />
    </button>
  );
}
