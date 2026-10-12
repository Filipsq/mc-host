import type { Metadata } from "next";
import { getMessages, getPreferences } from "@/i18n/server";
import { siteHost } from "@/lib/company";
import PrivacyPl from "./PrivacyPl";
import PrivacyEn from "./PrivacyEn";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).legal.privacy };
}

export default async function PrivacyPage() {
  const { locale } = await getPreferences();
  return (
    <main className="legal">
      {locale === "pl" ? <PrivacyPl site={siteHost()} /> : <PrivacyEn site={siteHost()} />}
    </main>
  );
}
