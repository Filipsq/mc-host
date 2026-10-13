import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { getPackArt } from "@/lib/modrinth";
import { CURATED_PACKS, isModLoader } from "@/lib/modpacks";
import { plans } from "@/lib/plans";
import { supportsPlugins } from "@/lib/plugins";
import { onHost } from "@/lib/servers";
import { kindLabel, typeOfKind, usesMods } from "@/lib/serverType";
import TypeForm from "./TypeForm";

export default async function ServerTypePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") notFound();
  const [t, { locale }, packArt] = await Promise.all([getMessages(), getPreferences(), getPackArt(CURATED_PACKS.map((p) => p.slug))]);

  return (
    <main className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}/settings`}>← {t.settings.title}</Link>
      <header className="stack-tight">
        <h1>{t.serverType.pageTitle}</h1>
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
          t={t.serverType}
          server={t.server}
        />
      ) : (
        <p className="notice">{t.serverType.errors.notOnHost}</p>
      )}
    </main>
  );
}
