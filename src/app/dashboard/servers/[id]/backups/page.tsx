import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import BackupsSection from "../BackupsSection";

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "backups");
  if (!server) notFound();
  if (server.status === "AWAITING_PAYMENT") redirect(`/dashboard/servers/${id}`);
  return <BackupsSection server={server} />;
}
