import Link from "next/link";
import type { Server } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { isServerKind } from "@/lib/modpacks";
import { EDITION_NAMES } from "@/lib/editions";
import { addressLabel } from "@/lib/servers";
import { diskLimitMb } from "@/lib/disk";
import { nodes } from "@/lib/nodes";
import type { Live } from "./data";
import type { Formats } from "./format";
import SortableTable from "./SortableTable";
import { sortable } from "./sortable";

export type ServerRow = Server & { owner: { id: string; email: string } };

type Props = { rows: ServerRow[]; live: Record<string, Live>; all: Messages; f: Formats; showOwner?: boolean };

const PLAN_ORDER = { FREE: 0, STARTER: 1, STANDARD: 2, PRO: 3 } as const;

export default function ServerTable({ rows, live, all, f, showOwner = true }: Props) {
  const t = all.admin;
  if (rows.length === 0) return <p className="muted">{t.noServers}</p>;
  const severalMachines = nodes().length > 1;
  const table = sortable<ServerRow>(
    [
      {
        label: t.columns.server,
        value: (s) => s.name,
        cell: (s) => (
          <td>
            <Link href={`/admin/servers/${s.id}`}>{s.name}</Link>
            <div className="mono muted small">{addressLabel(s)}</div>
          </td>
        ),
      },
      showOwner && {
        label: t.columns.owner,
        value: (s) => s.owner.email,
        cell: (s) => (
          <td>
            <Link href={`/admin/users/${s.owner.id}`}>{s.owner.email}</Link>
          </td>
        ),
      },
      {
        label: t.columns.type,
        value: (s) => `${EDITION_NAMES[s.edition]} ${s.kind}`,
        cell: (s) => (
          <td>
            {EDITION_NAMES[s.edition]}
            {s.edition === "JAVA" && isServerKind(s.kind) && s.kind !== "vanilla" && (
              <div className="muted small">{s.kind === "modpack" ? (s.modpackTitle ?? s.modpack) : all.server.kinds[s.kind]}</div>
            )}
          </td>
        ),
      },
      {
        label: t.columns.plan,
        desc: true,
        value: (s) => PLAN_ORDER[s.plan] * 1e6 + s.memoryMb,
        cell: (s) => (
          <td className="nowrap">
            {all.plans[s.plan]} · {f.gb(s.memoryMb)}
            {s.adminTest && <div className="muted small">{t.testServer}</div>}
          </td>
        ),
      },
      {
        label: t.columns.state,
        value: (s) => all.server.live[live[s.id].state],
        cell: (s) => (
          <td>
            <span className={`badge ${live[s.id].state}`}>{all.server.live[live[s.id].state]}</span>
            {severalMachines && <div className="muted small nowrap">{format(t.onMachine, { node: s.node })}</div>}
          </td>
        ),
      },
      {
        label: t.columns.players,
        desc: true,
        value: (s) => live[s.id].players,
        cell: (s) => {
          const l = live[s.id];
          return <td className="nowrap">{l.players !== undefined ? (l.maxPlayers ? `${l.players} / ${l.maxPlayers}` : l.players) : "–"}</td>;
        },
      },
      {
        // Longest running first; started earlier means a smaller date.
        label: t.columns.startedAgo,
        desc: true,
        value: (s) => (live[s.id].startedAt ? -live[s.id].startedAt!.getTime() : null),
        cell: (s) => <td className="nowrap">{live[s.id].startedAt ? f.ago(live[s.id].startedAt!) : "–"}</td>,
      },
      {
        label: t.columns.lastPlayed,
        desc: true,
        value: (s) => s.lastPlayedAt,
        cell: (s) => <td className="nowrap">{f.ago(s.lastPlayedAt)}</td>,
      },
      {
        label: t.columns.ramNow,
        desc: true,
        value: (s) => live[s.id].memoryUsedMb,
        cell: (s) => <td className="nowrap">{live[s.id].memoryUsedMb !== undefined ? f.gb(live[s.id].memoryUsedMb!) : "–"}</td>,
      },
      {
        label: t.columns.disk,
        desc: true,
        value: (s) => live[s.id].diskMb,
        cell: (s) => {
          const l = live[s.id];
          return (
            <td className={`nowrap${l.diskMb !== undefined && l.diskMb > diskLimitMb(s.plan) ? " over" : ""}`}>
              {l.diskMb !== undefined ? `${f.size(l.diskMb)} / ${f.size(diskLimitMb(s.plan))}` : "–"}
            </td>
          );
        },
      },
      {
        label: t.columns.paidUntil,
        desc: true,
        value: (s) => (s.plan !== "FREE" ? s.paidUntil : null),
        cell: (s) => <td className="nowrap">{s.plan !== "FREE" && s.paidUntil ? f.dateTime(s.paidUntil) : "–"}</td>,
      },
      {
        label: t.columns.created,
        desc: true,
        value: (s) => s.createdAt,
        cell: (s) => <td className="nowrap">{f.date(s.createdAt)}</td>,
      },
    ],
    rows,
    (s) => s.id,
  );
  return (
    <div className="table-scroll card flush">
      <SortableTable id={showOwner ? "servers" : "servers-of-user"} locale={f.locale} {...table} />
    </div>
  );
}
