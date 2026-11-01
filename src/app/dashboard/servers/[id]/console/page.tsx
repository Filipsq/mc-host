import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { isTerrariaKind } from "@/lib/terraria";
import Console from "../Console";

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "console");
  if (!server) notFound();
  // Unpaid servers aren't on the game host, so there's nothing to show.
  if (server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED") redirect(`/dashboard/servers/${id}`);

  const all = await getMessages();
  const terraria = server.edition === "TERRARIA";
  const tshock = terraria && isTerrariaKind(server.kind) && server.kind === "tshock";
  if (server.edition === "VALHEIM" || server.edition === "HYTALE") {
    const valheim = server.edition === "VALHEIM";
    return (
      <div className="stack">
        <Console
          id={server.id}
          game={null}
          input={!valheim}
          note={valheim ? all.otherGames.valheim.consoleNote : all.otherGames.hytale.consoleNote}
          t={all.server}
        />
      </div>
    );
  }
  return (
    <div className="stack">
      <Console
        id={server.id}
        game={terraria ? (tshock ? "tshock" : "terraria") : server.edition === "BEDROCK" ? "bedrock" : "java"}
        t={all.server}
      />
    </div>
  );
}
