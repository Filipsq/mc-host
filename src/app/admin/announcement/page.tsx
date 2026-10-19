import { requireAdmin } from "@/lib/admin";
import { ANNOUNCEMENT_MAX, getAnnouncement } from "@/lib/announcement";
import { getMessages } from "@/i18n/server";
import AnnouncementForm from "./AnnouncementForm";

export default async function AdminAnnouncementPage() {
  await requireAdmin();
  const [t, text] = await Promise.all([getMessages().then((all) => all.admin.announcement), getAnnouncement()]);
  return (
    <section className="card stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      <AnnouncementForm text={text} max={ANNOUNCEMENT_MAX} t={t} />
    </section>
  );
}
