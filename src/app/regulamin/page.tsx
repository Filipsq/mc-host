import type { Metadata } from "next";
import { getMessages, getPreferences } from "@/i18n/server";
import { siteHost } from "@/lib/company";
import TermsPl from "./TermsPl";
import TermsEn from "./TermsEn";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).legal.terms };
}

export default async function TermsPage() {
  const { locale } = await getPreferences();
  return (
    <main className="legal">
      {locale === "pl" ? <TermsPl site={siteHost()} /> : <TermsEn site={siteHost()} />}
    </main>
  );
}
