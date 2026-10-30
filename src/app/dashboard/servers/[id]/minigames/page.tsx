import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { plans } from "@/lib/plans";
import { kindLabel } from "@/lib/serverType";
import { MINIGAMES_FROM, minigamesBack } from "@/lib/minigamesSwitch";
import { enableMinigamesAction, leaveMinigamesAction } from "./actions";
import SwitchButton from "./SwitchButton";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> };

// Turning Minigames on for an ordinary server, and going back to its world (src/lib/minigamesSwitch.ts).
export default async function MinigamesPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { done }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") notFound();
  const all = await getMessages();
  const t = all.minigamesSwitch;
  const back = minigamesBack(server);
  const on = server.kind === "minigames";
  const backup = plans.find((p) => p.id === server.plan)!.backupsKept > 0;
  const message = done === "on" ? t.doneOn : done === "off" ? t.doneOff : done === "failed" ? t.failed : done === "notOnHost" ? t.notOnHost : null;

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      {message && <p className={done === "on" || done === "off" ? "notice" : "error"}>{message}</p>}
      <section className="card stack">
        <ul className="stack-tight">
          {t.games.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </section>
      {on && back ? (
        <section className="card stack">
          <h2 className="card-title">{t.backTitle}</h2>
          <p>
            {t.backText} <strong>{kindLabel({ kind: back.kind, version: back.version, modpack: null, modpackTitle: null }, all)}</strong>, {t.world} <strong>{back.level}</strong>.
          </p>
          <SwitchButton action={leaveMinigamesAction.bind(null, server.id)} label={t.backButton} pendingLabel={t.working} />
          <p className="muted small">{t.backNote}</p>
        </section>
      ) : on ? (
        <p className="notice">{t.already}</p>
      ) : MINIGAMES_FROM.includes(server.kind) ? (
        <section className="card stack">
          <h2 className="card-title">{t.onTitle}</h2>
          <ul className="stack-tight">
            <li>{t.onSaved}</li>
            <li>{t.onBack}</li>
            {server.plugins.length > 0 && <li>{t.onPlugins}</li>}
            {backup && <li>{t.onBackup}</li>}
            <li>{t.onRestart}</li>
          </ul>
          <SwitchButton action={enableMinigamesAction.bind(null, server.id)} label={t.onButton} pendingLabel={t.working} />
        </section>
      ) : (
        <p className="muted">{t.notHere}</p>
      )}
    </div>
  );
}
