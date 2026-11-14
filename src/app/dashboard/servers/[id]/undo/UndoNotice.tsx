import type { Server } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { kindLabel } from "@/lib/serverType";
import { undoChange, undoUntil } from "@/lib/undoChange";
import { undoChangeAction } from "./actions";
import UndoButton from "./UndoButton";

type Props = { server: Server; all: Messages; locale: string; owner: boolean };

/**
 * The owner's way back after a type or version change, for a few days
 * (src/lib/undoChange.ts): what the server ran before, and one button.
 */
export default function UndoNotice({ server, all, locale, owner }: Props) {
  if (!owner || server.edition !== "JAVA") return null;
  const back = undoChange(server);
  if (!back) return null;
  const t = all.undoChange;
  const date = (d: Date) => d.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" });
  const label = kindLabel({ kind: back.kind, version: back.version, modpack: back.modpack, modpackTitle: back.modpackTitle }, all);
  const vars = { type: label, world: back.level, date: date(new Date(back.at)), until: date(undoUntil(back)) };
  return (
    <div className="notice row">
      <span className="stack-tight">
        <strong>{back.what === "type" ? t.titleType : t.titleVersion}</strong>
        <span>{format(t.text, vars)}</span>
      </span>
      <UndoButton action={undoChangeAction.bind(null, server.id)} label={t.button} pendingLabel={t.working} question={format(t.confirm, vars)} />
    </div>
  );
}
