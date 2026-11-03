import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { allows, getServerAccess } from "@/lib/access";
import { getXbox, type XboxStatus } from "@/lib/agent";
import { takesBedrockPlayers, xboxAllowed } from "@/lib/xbox";
import AutoRefresh from "@/components/AutoRefresh";
import CopyButton from "@/components/CopyButton";
import XboxButtons from "./XboxButtons";

// Consoles (Xbox, PlayStation, Switch) can't add a server by its address. The
// owner signs an Xbox account in here; players add it as a friend and join the
// server from the game's Friends tab (src/lib/xbox.ts, agent/xbox.go).
export default async function XboxPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const access = await getServerAccess(id, session.user.id);
  if (!access || !allows(access, "owner") || !takesBedrockPlayers(access.server)) notFound();
  const { server } = access;
  const all = await getMessages();
  const t = all.xbox;
  const allowed = xboxAllowed(server);
  const on = server.xbox && allowed;
  const status: XboxStatus | null = on ? await getXbox(server.id).catch(() => null) : null;
  const waiting = status && (status.state === "starting" || status.state === "code" || status.state === "signedIn" || status.state === "off");

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>

      {!allowed ? (
        <section className="card stack">
          <p>{t.paidOnly}</p>
          <p>
            <Link className="button" href={`/dashboard/servers/${server.id}/upgrade`}>
              {t.upgrade}
            </Link>
          </p>
        </section>
      ) : (
        <section className="card stack">
          {!on && (
            <>
              <h3 className="card-title">{t.setupTitle}</h3>
              <ol className="stack-tight">
                {t.setup.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="muted small">{t.accountNote}</p>
            </>
          )}
          {on && !status && <p className="notice warn">{t.unreachable}</p>}
          {status?.state === "off" && <p className="muted">{t.state.notStarted}</p>}
          {status?.state === "starting" && <p className="muted">{t.state.starting}</p>}
          {status?.state === "code" && (
            <div className="stack-tight">
              <p>{t.state.code}</p>
              <div className="address-card">
                <div>
                  <p className="address-label">{t.codeLabel}</p>
                  <span className="address-value">{status.code}</span>
                </div>
                <CopyButton text={status.code ?? ""} label={all.server.copy} copiedLabel={all.server.copied} />
              </div>
              <p>
                <a className="button" href={status.url ?? "https://www.microsoft.com/link"} target="_blank" rel="noreferrer">
                  {t.openLink}
                </a>
              </p>
              <p className="muted small">{t.codeHint}</p>
            </div>
          )}
          {status?.state === "signedIn" && <p className="muted">{format(t.state.signedIn, { gamertag: status.gamertag ?? "" })}</p>}
          {status?.state === "live" && (
            <div className="stack-tight">
              <p className="notice success">{t.state.live}</p>
              <div className="address-card">
                <div>
                  <p className="address-label">{t.gamertagLabel}</p>
                  <span className="address-value">{status.gamertag}</span>
                </div>
                <CopyButton text={status.gamertag ?? ""} label={all.server.copy} copiedLabel={all.server.copied} />
              </div>
              <p className="muted small">{format(t.friends, { n: status.friends })}</p>
            </div>
          )}
          {status?.state === "error" && (
            <p className="notice warn">
              {t.state.error}
              {status.message && (
                <>
                  <br />
                  <code className="small">{status.message}</code>
                </>
              )}
            </p>
          )}
          <XboxButtons serverId={server.id} on={on} t={t} />
        </section>
      )}

      <section className="card stack">
        <h3 className="card-title">{t.playersTitle}</h3>
        <ol className="stack-tight">
          {t.players.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">{t.playersNote}</p>
      </section>
      {waiting && <AutoRefresh everyMs={5000} />}
    </div>
  );
}
