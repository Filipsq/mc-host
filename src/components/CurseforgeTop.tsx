import Link from "next/link";
import { Package } from "lucide-react";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { LOADER_NAMES, planForRam } from "@/lib/modpacks";
import type { CurseforgePack } from "@/lib/curseforge";

type Props = {
  packs: CurseforgePack[];
  t: Messages["home"];
  server: Messages["server"];
  planNames: Record<Plan, string>;
  locale: string;
  link: (slug: string) => string; // where a card leads
};

/** CurseForge's most popular packs that run on our plans, numbered in their ranking order. */
export default function CurseforgeTop({ packs, t, server, planNames, locale, link }: Props) {
  const numbers = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  return (
    <ol className="cf-top">
      {packs.map((p, i) => (
        <li key={p.id}>
          <Link className="cf-card" href={link(p.slug)} prefetch={false}>
            <span className="cf-rank" aria-hidden>
              {i + 1}
            </span>
            <span className="cf-logo">
              {p.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- CurseForge's own image host
                <img src={p.icon} alt="" width={56} height={56} loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <Package size={24} aria-hidden />
              )}
            </span>
            <span className="cf-text">
              <strong>{p.title}</strong>
              <span className="muted small cf-summary">{p.summary}</span>
              <span className="muted small">
                {format(t.cfMeta, {
                  downloads: numbers.format(p.downloads),
                  version: p.gameVersion,
                  loader: LOADER_NAMES[p.loader] ?? p.loader,
                  mods: p.mods,
                })}
              </span>
              <span className="pack-meta">
                <span className="ram-pill">{format(server.ramFrom, { gb: p.ramGb })}</span>
                <span className="muted small">{format(server.packPlan, { plan: planNames[planForRam(p.ramGb)] })}</span>
              </span>
            </span>
            <span className="button small cf-launch">{t.cfLaunch}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
