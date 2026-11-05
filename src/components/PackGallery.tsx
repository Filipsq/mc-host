import Link from "next/link";
import { Package, Play } from "lucide-react";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import type { PackArt } from "@/lib/modrinth";
import type { CurseforgePack } from "@/lib/curseforge";

type Props = {
  t: Messages["server"];
  cta: string;
  planNames: Record<Plan, string>;
  art: Map<string, PackArt>;
  cf: CurseforgePack[] | null;
};

type Tile = { key: string; href: string; title: string; text: string; ramGb: number; image?: string; icon?: string };

const MAX = 8;

/**
 * "W co dziś gramy?": the curated Modrinth packs and CurseForge's most popular,
 * as big picture tiles. Each one goes through /graj, which opens the create page
 * with that pack picked, after sign-up if needed. Rows stay full: four on wide
 * screens, two on phones.
 */
export default function PackGallery({ t, cta, planNames, art, cf }: Props) {
  const curated: Tile[] = CURATED_PACKS.map((p) => ({
    key: `mr-${p.slug}`,
    href: `/graj?pack=${p.slug}`,
    title: p.title,
    text: t.packs[p.slug],
    ramGb: p.ramGb,
    image: art.get(p.slug)?.image,
    icon: art.get(p.slug)?.icon,
  }));
  const names = new Set(curated.map((p) => p.title.toLowerCase()));
  const top: Tile[] = (cf ?? [])
    .filter((p) => !names.has(p.title.toLowerCase()))
    .map((p) => ({ key: `cf-${p.id}`, href: `/graj?cf=${p.slug}`, title: p.title, text: p.summary, ramGb: p.ramGb, image: p.picture, icon: p.icon }));
  // CurseForge's top ones first in the mix: they're the names players search for.
  const all = [...top.slice(0, 3), ...curated, ...top.slice(3)];
  const tiles = all.slice(0, all.length >= MAX ? MAX : Math.max(4, all.length - (all.length % 4)));
  return (
    <ul className="pack-gallery">
      {tiles.map((p) => {
        const backdrop = p.image ?? p.icon;
        return (
          <li key={p.key}>
            <Link className="pack-tile gallery-tile" href={p.href} prefetch={false}>
              <span className="pack-art-frame">
                <span
                  className={`pack-art${p.image ? "" : p.icon ? " pack-art-blur" : " pack-art-empty"}`}
                  style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
                />
              </span>
              <span className="pack-body">
                <span className="pack-icon">
                  {p.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small icons from the pack sites
                    <img src={p.icon} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <Package size={22} aria-hidden />
                  )}
                </span>
                <strong>{p.title}</strong>
                <span className="muted small gallery-text">{p.text}</span>
                <span className="pack-meta">
                  <span className="ram-pill">{format(t.ramFrom, { gb: p.ramGb })}</span>
                  <span className="muted small">{format(t.packPlan, { plan: planNames[planForRam(p.ramGb)] })}</span>
                </span>
                <span className="button gallery-cta"><Play size={16} aria-hidden /> {cta}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
