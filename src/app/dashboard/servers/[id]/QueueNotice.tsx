"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { leaveQueueAction, startServerAction } from "../actions";
import type { Messages } from "@/i18n/messages";

type Props = { id: string; owner: boolean; price: string; t: Messages["server"]["queue"] };

/**
 * Shown while a free server waits for room: it tries to start again by itself,
 * and offers the plan that starts at once.
 */
export default function QueueNotice({ id, owner, price, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const result = await startServerAction(id).catch(() => null);
      if (result && !result.queued) router.refresh();
    }, 45_000);
    return () => clearInterval(timer);
  }, [id, router]);

  return (
    <div className="notice warn queue-notice">
      <p>
        <Hourglass size={16} aria-hidden /> <strong>{t.title}</strong> {t.text}
      </p>
      <div className="row">
        {owner && (
          <Link className="button small" href={`/dashboard/servers/${id}/billing`}>
            {t.upgrade.replace("{price}", price)}
          </Link>
        )}
        <button className="secondary small" disabled={pending} onClick={() => startTransition(() => leaveQueueAction(id))}>
          {t.leave}
        </button>
      </div>
    </div>
  );
}
