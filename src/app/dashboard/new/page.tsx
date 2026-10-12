import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { planOptions } from "@/lib/planOptions";
import CreateServerForm from "./CreateServerForm";

export default async function NewServerPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [t, { locale, currency }, freeCount] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.server.count({ where: { ownerId: session.user.id, plan: "FREE" } }),
  ]);
  const hasFree = freeCount > 0;
  const plans = planOptions(t, currency).map((p) =>
    p.id === "FREE" && hasFree ? { ...p, disabledNote: t.server.freeTaken } : p,
  );

  return (
    <main className="wide-form stack">
      <Link className="back" href="/dashboard">{t.server.back}</Link>
      <h1>{t.server.newTitle}</h1>
      <CreateServerForm
        t={t.server}
        billing={t.billing}
        legal={t.legal}
        plans={plans}
        defaultPlan={hasFree ? "STARTER" : "FREE"}
        domain={process.env.GAME_DOMAIN ?? "localhost"}
        money={{ locale, currency }}
      />
    </main>
  );
}
