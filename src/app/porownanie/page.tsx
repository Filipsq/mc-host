import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus, X } from "lucide-react";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { BRAND_NAME } from "@/lib/brand";
import { planById } from "@/lib/plans";
import { MEMBERS_MAX } from "@/lib/access";
import { PROVIDERS, SOURCES, type Mark } from "@/lib/comparison";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages()).compare;
  return { title: t.title, description: t.description };
}

const MARK_ICONS = { yes: Check, no: X, some: Minus } as const;

export default async function ComparePage() {
  const t = (await getMessages()).compare;
  const names = PROVIDERS.map((p, i) => (i === 0 ? BRAND_NAME : p));
  // Our own cells follow the free plan, so they stay right when it changes.
  const free = planById("FREE");
  const ours = { ram: free.ramGb, disk: free.diskGb, members: MEMBERS_MAX };
  return (
    <main className="compare stack">
      <header className="stack-tight">
        <h1>{t.title}</h1>
        <p className="lead">{t.intro}</p>
      </header>
      <div className="table-scroll compare-scroll">
        <table className="compare-table">
          <caption className="sr-only">{t.title}</caption>
          <thead>
            <tr>
              <th scope="col">{t.feature}</th>
              {names.map((name, i) => (
                <th key={name} scope="col" className={i === 0 ? "us" : undefined}>
                  {name}
                  <span className="compare-plan">{t.freePlan}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                {row.cells.map(([mark, text], i) => (
                  <td key={PROVIDERS[i]} className={i === 0 ? "us" : undefined}>
                    <Cell mark={mark as Mark} text={i === 0 ? format(text, ours) : text} labels={t.marks} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="stack-tight compare-notes">
        <p className="muted small">{t.asOf}</p>
        <p className="muted small">{t.notAffiliated}</p>
        <p className="muted small">
          {t.fixBefore}
          <Link href="/kontakt">{t.fixLink}</Link>
          {t.fixAfter}
        </p>
      </section>
      <section className="stack-tight">
        <h2>{t.sourcesTitle}</h2>
        <div className="compare-sources small">
          {PROVIDERS.slice(1).map((provider) => (
            <div key={provider} className="stack-tight">
              <strong>{provider}</strong>
              <ul className="stack-tight">
                {SOURCES.filter((s) => s.provider === provider).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <div className="card row compare-cta">
        <div className="stack-tight">
          <strong>{t.ctaTitle}</strong>
          <span className="muted small">{t.ctaText}</span>
        </div>
        <div className="hero-actions">
          <Link className="button" href="/signup">
            {t.ctaButton}
          </Link>
          <Link className="button secondary" href="/#cennik">
            {t.pricingButton}
          </Link>
        </div>
      </div>
    </main>
  );
}

function Cell({ mark, text, labels }: { mark: Mark; text: string; labels: Record<Exclude<Mark, "info">, string> }) {
  if (mark === "info") return <span className="compare-text">{text}</span>;
  const Icon = MARK_ICONS[mark];
  return (
    <span className={`compare-cell ${mark}`}>
      <Icon size={18} strokeWidth={2.6} aria-hidden className="compare-icon" />
      <span className="sr-only">{labels[mark]}: </span>
      <span className="compare-text">{text}</span>
    </span>
  );
}
