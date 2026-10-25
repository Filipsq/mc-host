import { notFound, redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { searchAddons } from "@/lib/modrinth";
import { offersModPicker } from "@/lib/plugins";
import { planAtLeast, planForRam } from "@/lib/modpacks";
import { gameById } from "@/lib/games";
import ModPicker from "./ModPicker";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> };

/**
 * Mods on a plain server, which can't run them: the owner picks them here,
 * and the end of the list says the server has to switch to Fabric (a mod
 * server has its mods under the Plugins page's path instead).
 */
export default async function ModsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "plugins");
  if (!server) notFound();
  if (!offersModPicker(server)) redirect(`/dashboard/servers/${id}/plugins`);
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.modsOnPlain;
  const query = q.trim().slice(0, 100);
  const mc = server.version !== "LATEST" ? server.version : undefined;
  const hits = await searchAddons("mod", query, { gameVersion: mc, loader: "fabric" });
  const modsPlan = planForRam(gameById("mods").ramGb);

  return (
    <div className="stack">
      <h2>{all.mods.title}</h2>
      <p className="muted">{format(t.intro, { version: mc ? `, Minecraft ${mc}` : "" })}</p>
      <form className="plugin-search" action={`/dashboard/servers/${server.id}/mods`}>
        <input name="q" type="search" defaultValue={query} placeholder={all.mods.searchPlaceholder} aria-label={all.mods.search} maxLength={100} />
        <button>
          <Search size={16} aria-hidden /> {all.plugins.searchButton}
        </button>
      </form>
      <p className="muted small">{query ? format(all.plugins.results, { q: query }) : all.plugins.popular}</p>
      {hits === "modrinthUnavailable" ? (
        <p className="notice warn">{all.mods.errors.modrinthUnavailable}</p>
      ) : (
        <ModPicker
          id={server.id}
          hits={hits}
          needsPlan={!planAtLeast(server.plan, modsPlan)}
          planName={all.plans[modsPlan]}
          t={t}
          downloads={all.plugins.downloads}
          locale={locale}
        />
      )}
    </div>
  );
}
