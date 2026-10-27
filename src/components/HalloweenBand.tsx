import type { ReactNode } from "react";
import { format, type Messages } from "@/i18n/messages";
import { HALLOWEEN_CODE, HALLOWEEN_DISCOUNT, HUNT_PUMPKINS } from "@/lib/halloween";
import { HuntProgress, PixelPumpkin } from "./Halloween";

/** The home page's Halloween event (lib/halloween.ts): the pumpkin hunt and its code, and room for Halloween games below. */
export default function HalloweenBand({ t, signedIn, children }: { t: Messages["halloween"]; signedIn: boolean; children?: ReactNode }) {
  const vars = { total: HUNT_PUMPKINS, percent: HALLOWEEN_DISCOUNT, code: HALLOWEEN_CODE.toUpperCase() };
  return (
    <section className="section halloween-section" id="halloween">
      <div className="container stack-large">
        <div className="halloween-band">
          <span className="halloween-band-art"><PixelPumpkin size={72} /></span>
          <div className="halloween-band-copy">
            <p className="halloween-eyebrow">{t.eyebrow}</p>
            <h2 className="display">{t.title}</h2>
            <p>{format(t.text, vars)}</p>
            <p className="muted small">{t.rules}</p>
          </div>
          <HuntProgress
            total={HUNT_PUMPKINS}
            code={HALLOWEEN_CODE}
            href={signedIn ? `/dashboard/new?kod=${HALLOWEEN_CODE.toUpperCase()}` : "/signup"}
            t={{ progress: t.progress, done: format(t.done, vars), buy: t.buy, copy: t.copy, copied: t.copied }}
          />
        </div>
        {children}
      </div>
    </section>
  );
}
