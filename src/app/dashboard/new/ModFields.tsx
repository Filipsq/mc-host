"use client";

import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, LOADER_NAMES, MOD_LOADERS, planForRam, type ModLoader } from "@/lib/modpacks";
import { LOADER_VERSIONS, MOD_DEFAULT_VERSION } from "@/lib/settings";
import PackSearch from "./PackSearch";

// The mod pack and mod loader choices, shared by the new server form and the
// page that changes a server's type.

/** A CurseForge pack picked on the home page, offered first. */
export type CurseforgeOption = {
  slug: string;
  title: string;
  summary: string;
  icon?: string;
  ramGb: number;
  mods: number;
  gameVersion: string;
  loader: string;
};

type PackProps = {
  t: Messages["server"];
  pack: string; // a curated pack's slug, "custom", or "curseforge" for cfPack
  onPack: (slug: string) => void;
  packIcons: Record<string, string | undefined>;
  planName: (plan: Plan) => string;
  locale: string;
  initialLink?: string;
  cfPack?: CurseforgeOption;
  curseforge?: boolean; // whether CurseForge links work
};

export function PackFields({ t, pack, onPack, packIcons, planName, locale, initialLink, cfPack, curseforge }: PackProps) {
  return (
    <fieldset className="stack">
      <legend>{t.modpack}</legend>
      {cfPack && (
        <label className="choice plan-choice">
          <input type="radio" name="pack" value="curseforge" checked={pack === "curseforge"} onChange={() => onPack("curseforge")} />
          <input type="hidden" name="cfPack" value={cfPack.slug} />
          {cfPack.icon && (
            // eslint-disable-next-line @next/next/no-img-element -- CurseForge's own image host
            <img className="pack-option-icon" src={cfPack.icon} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" />
          )}
          <span className="stack-tight">
            <span>
              <strong>{cfPack.title}</strong> <span className="chip small-chip">{t.packCurseforge}</span>{" "}
              <span className="muted">{cfPack.summary}</span>
            </span>
            <span className="muted small">
              {format(t.packCurseforgeMeta, { mods: cfPack.mods, version: cfPack.gameVersion, loader: LOADER_NAMES[cfPack.loader] ?? cfPack.loader })}
            </span>
            <span className="pack-meta">
              <span className="ram-pill">{format(t.ramFrom, { gb: cfPack.ramGb })}</span>
              <span className="muted small">{format(t.packPlan, { plan: planName(planForRam(cfPack.ramGb)) })}</span>
            </span>
          </span>
        </label>
      )}
      {CURATED_PACKS.map((p) => (
        <label key={p.slug} className="choice plan-choice">
          <input type="radio" name="pack" value={p.slug} checked={pack === p.slug} onChange={() => onPack(p.slug)} />
          {packIcons[p.slug] && (
            // eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon
            <img className="pack-option-icon" src={packIcons[p.slug]} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" />
          )}
          <span className="stack-tight">
            <span>
              <strong>{p.title}</strong> <span className="muted">{t.packs[p.slug]}</span>
            </span>
            <span className="pack-meta">
              <span className="ram-pill">{format(t.ramFrom, { gb: p.ramGb })}</span>
              <span className="muted small">{format(t.packPlan, { plan: planName(planForRam(p.ramGb)) })}</span>
            </span>
          </span>
        </label>
      ))}
      <label className="choice">
        <input type="radio" name="pack" value="custom" checked={pack === "custom"} onChange={() => onPack("custom")} />
        <span>
          <strong>{t.packOther}</strong> <span className="muted">{t.packOtherHint}</span>
        </span>
      </label>
      {pack === "custom" && <PackSearch t={t} locale={locale} initial={initialLink} />}
      {pack === "custom" && curseforge && <p className="muted small">{t.packLinkCurseforge}</p>}
      <p className="muted small">{pack === "curseforge" ? t.modpackNoteCurseforge : t.modpackNote}</p>
    </fieldset>
  );
}

type LoaderProps = {
  t: Messages["server"];
  loader: ModLoader;
  version: string;
  onLoader: (loader: ModLoader) => void;
  onVersion: (version: string) => void;
};

export function LoaderFields({ t, loader, version, onLoader, onVersion }: LoaderProps) {
  return (
    <fieldset className="stack">
      <legend>{t.loader}</legend>
      {MOD_LOADERS.map((l) => (
        <label key={l} className="choice">
          <input
            type="radio"
            name="loader"
            value={l}
            checked={loader === l}
            onChange={() => {
              onLoader(l);
              if (!LOADER_VERSIONS[l].includes(version)) onVersion(MOD_DEFAULT_VERSION);
            }}
          />
          <span>
            <strong>{LOADER_NAMES[l]}</strong> <span className="muted">{t.loaderHints[l]}</span>
          </span>
        </label>
      ))}
      <label>
        {t.modVersion}
        <select name="modVersion" value={version} onChange={(e) => onVersion(e.target.value)}>
          {LOADER_VERSIONS[loader].map((ver) => (
            <option key={ver} value={ver}>
              {ver === "LATEST" ? t.latestVersion : ver}
            </option>
          ))}
        </select>
        <span className="muted small">{t.modVersionHint}</span>
      </label>
      <p className="muted small">{t.modsNote}</p>
    </fieldset>
  );
}
