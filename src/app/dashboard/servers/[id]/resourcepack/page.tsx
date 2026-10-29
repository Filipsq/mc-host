import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { allows, getServerAccess } from "@/lib/access";
import { getLiveDetailsOnce } from "@/lib/servers";
import PackForm from "./PackForm";

// The resource pack (texture pack) players' games download on joining a Java
// server: a link to its .zip, whether players must take it, and the line the
// game shows with the question (src/lib/resourcePack.ts).
export default async function ResourcePackPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const access = await getServerAccess(id, session.user.id);
  if (!access || !allows(access, "settings") || access.server.edition !== "JAVA") notFound();
  const { server } = access;
  const [all, { live }] = await Promise.all([getMessages(), getLiveDetailsOnce(server.id, server.status)]);
  const t = all.resourcePack;

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      <PackForm
        serverId={server.id}
        initial={{ url: server.resourcePack ?? "", required: server.resourcePackRequired, prompt: server.resourcePackPrompt }}
        running={live === "online" || live === "starting"}
        t={t}
      />
      <section className="card stack">
        <h2 className="card-title">{t.howTitle}</h2>
        <ol className="stack-tight">
          {t.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted small">{t.bedrockNote}</p>
      </section>
    </div>
  );
}
