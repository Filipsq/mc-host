import type { Metadata } from "next";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { db } from "@/lib/db";
import { COMEBACK_DAYS, checkUnsubscribe } from "@/lib/comeback";
import { setComeback } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).comebackPage.title, robots: { index: false } };
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const t = (await getMessages()).comebackPage;
  const { u = null, t: token = null } = await searchParams;
  const user = checkUnsubscribe(u, token) ? await db.user.findUnique({ where: { id: u }, select: { comebackOff: true } }) : null;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.title}</h1>
      </header>
      {!user ? (
        <p className="notice warn">{t.invalid}</p>
      ) : (
        <form action={setComeback} className="card stack">
          <input type="hidden" name="u" value={u!} />
          <input type="hidden" name="t" value={token!} />
          <input type="hidden" name="off" value={user.comebackOff ? "0" : "1"} />
          <p className={user.comebackOff ? "notice success" : undefined}>
            {user.comebackOff ? t.off : format(t.on, { days: COMEBACK_DAYS })}
          </p>
          <button type="submit">{user.comebackOff ? t.turnOn : t.turnOff}</button>
        </form>
      )}
    </main>
  );
}
