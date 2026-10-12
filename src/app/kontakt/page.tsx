import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { getMessages } from "@/i18n/server";
import { company } from "@/lib/company";
import Blank from "@/components/legal/Blank";
import LinkedText from "@/components/legal/LinkedText";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).legal.contact };
}

export default async function ContactPage() {
  const t = (await getMessages()).legal;
  return (
    <main className="wide-form stack">
      <h1>{t.contact}</h1>
      <p className="muted">{t.contactIntro}</p>
      <div className="card stack">
        <div>
          <p className="address-label">{t.email}</p>
          {company.email ? (
            <a className="contact-email" href={`mailto:${company.email}`}>
              <Mail size={18} aria-hidden /> {company.email}
            </a>
          ) : (
            <Blank value="" label={t.blankEmail} />
          )}
        </div>
        <p className="muted small">{t.contactTip}</p>
      </div>
      <section className="stack">
        <h2>{t.complaintsTitle}</h2>
        <p>
          <LinkedText text={t.complaintsText} href="/regulamin" label={t.termsLinkGenitive} />
        </p>
      </section>
      <section className="stack">
        <h2>{t.operatorTitle}</h2>
        <p>
          <Blank value={company.name} label={t.blankName} />
          <br />
          <Blank value={company.address} label={t.blankAddress} />
          {company.nip && (
            <>
              <br />
              NIP {company.nip}
            </>
          )}
        </p>
      </section>
    </main>
  );
}
