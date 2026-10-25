import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { getPackArt } from "@/lib/modrinth";
import { curseforgeEnabled, curseforgePackOptions } from "@/lib/curseforge";
import { CURATED_PACKS, isModLoader } from "@/lib/modpacks";
import { plans } from "@/lib/plans";
import { PLUGINS_MAX, isProjectId, supportsPlugins } from "@/lib/plugins";
import { onHost } from "@/lib/servers";
import { kindLabel, typeOfKind, usesMods } from "@/lib/serverType";
import TypeForm from "./TypeForm";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ type?: string; mods?: string }> };

export default async function ServerTypePage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Mods picked on a plain server's Mods page come along, to be added once it runs Fabric.
  const pickedMods = query.type === "mods" ? [...new Set((query.mods ?? "").split(","))].filter(isProjectId).slice(0, PLUGINS_MAX) : [];
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") notFound();
  const [t, { locale }, packArt, cfPacks] = await Promise.all([
    getMessages(),
    getPreferences(),
    getPackArt(CURATED_PACKS.map((p) => p.slug)),
    curseforgeEnabled() ? curseforgePackOptions() : [],
  ]);

  return (
    <div className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}/settings`}>← {t.settings.title}</Link>
      <header className="stack-tight">
        <h2>{t.serverType.pageTitle}</h2>
        <p className="muted">
          {t.serverType.title}: <strong>{kindLabel(server, t)}</strong>
        </p>
        <p className="muted">{t.serverType.intro}</p>
      </header>
      {onHost(server) ? (
        <TypeForm
          id={server.id}
          current={{
            type: typeOfKind(server.kind),
            loader: isModLoader(server.kind) ? server.kind : undefined,
            version: server.version,
            pack: server.modpack ?? undefined,
          }}
          plan={server.plan}
          planNames={t.plans}
          planRam={Object.fromEntries(plans.map((p) => [p.id, p.ramGb])) as Record<(typeof plans)[number]["id"], number>}
          packIcons={Object.fromEntries(CURATED_PACKS.map((p) => [p.slug, packArt.get(p.slug)?.icon]))}
          locale={locale}
          notes={{ backup: plans.find((p) => p.id === server.plan)!.backupsKept > 0, modsMoved: usesMods(server.kind), plugins: supportsPlugins(server) && server.plugins.length > 0 }}
          curseforge={curseforgeEnabled()}
          cfPacks={cfPacks}
          pickedMods={pickedMods}
          t={t.serverType}
          server={t.server}
        />
      ) : (
        <p className="notice">{t.serverType.errors.notOnHost}</p>
      )}
    </div>
  );
}
