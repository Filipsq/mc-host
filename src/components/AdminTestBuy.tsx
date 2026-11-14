import type { Messages } from "@/i18n/messages";

/**
 * The admin's free test purchase on their own test server (Server.adminTest):
 * submits the form with adminTest=on, so the action applies it for 0 without
 * Stripe. Shown only when the page checked both; the action checks again.
 */
export default function AdminTestBuy({ show, pending, t }: { show?: boolean; pending: boolean; t: Messages["billing"] }) {
  if (!show) return null;
  return (
    <div className="stack-tight">
      {/* formNoValidate: the start-now consent isn't needed for a test. */}
      <button type="submit" className="secondary" name="adminTest" value="on" formNoValidate disabled={pending}>
        {t.adminTest}
      </button>
      <span className="muted small">{t.adminTestHint}</span>
    </div>
  );
}
