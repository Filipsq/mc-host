import type { Messages } from "@/i18n/messages";
import { lookupGiftAction } from "./actions";

/** "Masz kod prezentowy?": a code box that opens the redeem page. */
export default function GiftCodeForm({ t, code = "" }: { t: Messages["gifts"]; code?: string }) {
  return (
    <form action={lookupGiftAction} className="card stack">
      <h2>{t.haveCode}</h2>
      <div className="row invite-redeem">
        <label className="grow">
          {t.codeField}
          <input
            name="code"
            defaultValue={code}
            required
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t.codePlaceholder}
          />
        </label>
        <button type="submit" className="secondary">{t.redeemButton}</button>
      </div>
    </form>
  );
}
