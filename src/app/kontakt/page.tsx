import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
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
      <div className="card row">
        <div className="stack-tight">
          <strong>{t.chatTitle}</strong>
          <span className="muted small">{t.chatText}</span>
        </div>
        <Link className="button" href="/dashboard/support">
          <MessageCircle size={18} aria-hidden /> {t.chatButton}
        </Link>
      </div>
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
