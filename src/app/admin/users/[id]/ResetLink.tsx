"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import CopyButton from "@/components/CopyButton";
import { resetLinkAdminAction } from "../../actions";
import type { Messages } from "@/i18n/messages";

export default function ResetLink({ userId, t }: { userId: string; t: Messages["admin"]["resetLink"] }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  return (
    <div className="stack">
      <div>
        <button
          className="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await resetLinkAdminAction(userId).catch(() => ({ error: "failed" as const, url: undefined }));
              setFailed(!!res.error);
              setUrl(res.url);
            })
          }
        >
          <KeyRound size={16} aria-hidden /> {t.submit}
        </button>
      </div>
      {failed && <p className="error">{t.failed}</p>}
      {url && (
        <div className="row">
          <input readOnly value={url} className="mono" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={url} label={t.copy} copiedLabel={t.copied} />
        </div>
      )}
    </div>
  );
}
