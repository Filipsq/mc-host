import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { stripeTestMode } from "@/lib/stripe";
import { getMessages } from "@/i18n/server";
import AdminNav from "./AdminNav";
import SupportWatch from "./SupportWatch";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).admin.title, robots: { index: false } };
}

// Every page checks for an admin too: a layout alone doesn't guard what its pages return.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const [t, waiting] = await Promise.all([
    getMessages().then((all) => all.admin),
    db.supportChat.count({ where: { staffUnread: { gt: 0 } } }),
  ]);
  return (
    <main className="stack admin">
      <h1>{t.title}</h1>
      <SupportWatch />
      <AdminNav labels={t.nav} counts={{ support: waiting }} />
      {stripeTestMode() && <p className="notice warn">{t.testMode}</p>}
      {children}
    </main>
  );
}
