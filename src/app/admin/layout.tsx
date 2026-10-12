import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getMessages } from "@/i18n/server";
import AdminNav from "./AdminNav";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).admin.title, robots: { index: false } };
}

// Every page checks for an admin too: a layout alone doesn't guard what its pages return.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const t = (await getMessages()).admin;
  return (
    <main className="stack admin">
      <h1>{t.title}</h1>
      <AdminNav labels={t.nav} />
      {children}
    </main>
  );
}
