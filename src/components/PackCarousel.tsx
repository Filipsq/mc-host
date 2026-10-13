import Link from "next/link";
import { Package } from "lucide-react";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import type { PackArt } from "@/lib/modrinth";

type Props = {
  t: Messages["server"];
  planNames: Record<Plan, string>;
  art: Map<string, PackArt>;
  label: string;
  link: (slug: string) => string; // where a card leads
};

/**
 * The curated mod packs as tall cards with their pictures, sliding left in an
 * endless row. The row is drawn twice so it can loop; the copy is hidden from
 * screen readers and the keyboard. It stops on hover, and stands still (and
 * scrolls by hand) for people who turned off animations.
 */
export default function PackCarousel({ t, planNames, art, label, link }: Props) {
  const cards = (copy: boolean) =>
    CURATED_PACKS.map((p) => {
      const { icon, image } = art.get(p.slug) ?? {};
      return (
        <li key={`${p.slug}${copy ? "-copy" : ""}`} className={copy ? "pack-slide pack-copy" : "pack-slide"} aria-hidden={copy || undefined} inert={copy}>
          <Link className="pack-tile" href={link(p.slug)} prefetch={false}>
            {/* A pack without pictures gets its icon, blurred, as the backdrop. */}
            <span className="pack-art-frame">
              <span
                className={`pack-art${image ? "" : icon ? " pack-art-blur" : " pack-art-empty"}`}
                style={image || icon ? { backgroundImage: `url("${image ?? icon}")` } : undefined}
              />
            </span>
            <span className="pack-body">
              <span className="pack-icon">
                {icon ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon
                  <img src={icon} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <Package size={22} aria-hidden />
                )}
              </span>
              <strong>{p.title}</strong>
              <span className="muted small">{t.packs[p.slug]}</span>
              <span className="pack-meta">
                <span className="ram-pill">{format(t.ramFrom, { gb: p.ramGb })}</span>
                <span className="muted small">{format(t.packPlan, { plan: planNames[planForRam(p.ramGb)] })}</span>
              </span>
            </span>
          </Link>
        </li>
      );
    });

  return (
    <div className="pack-marquee">
      <ul className="pack-track" aria-label={label}>
        {cards(false)}
        {cards(true)}
      </ul>
    </div>
  );
}
