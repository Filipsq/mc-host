import { requireAdmin } from "@/lib/admin";
import { hytaleStatus } from "@/lib/hytale";
import { getMessages } from "@/i18n/server";
import HytaleLogin from "./HytaleLogin";

/** The Hytale account every Hytale server signs in with (src/lib/hytale.ts). */
export default async function AdminHytalePage() {
  await requireAdmin();
  const [t, status] = await Promise.all([getMessages().then((all) => all.admin.hytale), hytaleStatus()]);
  return (
    <div className="stack">
      <section className="card stack">
        <h2>{t.title}</h2>
        <p className="muted">{t.intro}</p>
      </section>
      <section className="card stack">
        <h3>{t.serverTitle}</h3>
        <p className="muted small">{t.serverHint}</p>
        <HytaleLogin kind="server" status={status.server} t={t} />
      </section>
      <section className="card stack">
        <h3>{t.downloaderTitle}</h3>
        <p className="muted small">{t.downloaderHint}</p>
        <HytaleLogin kind="downloader" status={status.downloader} t={t} />
      </section>
    </div>
  );
}
