import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getOwnedServer } from "@/lib/servers";
import { planOptions } from "@/lib/planOptions";
import CheckoutForm from "./CheckoutForm";

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const [t, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  const activePaid = server.plan !== "FREE" && server.paidUntil && server.paidUntil > new Date();

  return (
    <main className="narrow wide-form stack">
      <p><Link href={`/dashboard/servers/${server.id}`}>← {server.name}</Link></p>
      <h1>{t.billing.title}</h1>
      <p className="muted">
        {t.plans[server.plan]} ·{" "}
        {server.plan === "FREE"
          ? t.billing.freeForever
          : server.paidUntil
            ? format(activePaid ? t.billing.paidUntil : t.billing.expiredOn, {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil),
              })
            : t.server.live.awaitingPayment}
      </p>
      <CheckoutForm
        serverId={server.id}
        plans={planOptions(t, currency, (p) => p !== "FREE")}
        defaultPlan={server.plan === "FREE" ? "STARTER" : server.plan}
        note={activePaid ? `${t.billing.extendNote} ${t.billing.credit}` : undefined}
        t={t.billing}
        labels={{ plan: t.billing.choosePlan, period: t.server.period }}
        errors={t.server.errors}
        money={{ locale, currency }}
      />
    </main>
  );
}
