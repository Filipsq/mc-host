import Link from "next/link";
import type { Server } from "@prisma/client";
import type { Messages } from "@/i18n/messages";
import { isServerKind } from "@/lib/modpacks";
import { EDITION_NAMES } from "@/lib/editions";
import { addressLabel } from "@/lib/servers";
import { diskLimitMb } from "@/lib/disk";
import type { Live } from "./data";
import type { Formats } from "./format";

export type ServerRow = Server & { owner: { id: string; email: string } };

type Props = { rows: ServerRow[]; live: Record<string, Live>; all: Messages; f: Formats; showOwner?: boolean };

export default function ServerTable({ rows, live, all, f, showOwner = true }: Props) {
  const t = all.admin;
  if (rows.length === 0) return <p className="muted">{t.noServers}</p>;
  return (
    <div className="table-scroll card flush">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t.columns.server}</th>
            {showOwner && <th>{t.columns.owner}</th>}
            <th>{t.columns.type}</th>
            <th>{t.columns.plan}</th>
            <th>{t.columns.state}</th>
            <th>{t.columns.ramNow}</th>
            <th>{t.columns.disk}</th>
            <th>{t.columns.paidUntil}</th>
            <th>{t.columns.created}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const l = live[s.id];
            return (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/servers/${s.id}`}>{s.name}</Link>
                  <div className="mono muted small">{addressLabel(s)}</div>
                </td>
                {showOwner && (
                  <td>
                    <Link href={`/admin/users/${s.owner.id}`}>{s.owner.email}</Link>
                  </td>
                )}
                <td>
                  {EDITION_NAMES[s.edition]}
                  {s.edition === "JAVA" && isServerKind(s.kind) && s.kind !== "vanilla" && (
                    <div className="muted small">{s.kind === "modpack" ? (s.modpackTitle ?? s.modpack) : all.server.kinds[s.kind]}</div>
                  )}
                </td>
                <td className="nowrap">
                  {all.plans[s.plan]} · {f.gb(s.memoryMb)}
                </td>
                <td>
                  <span className={`badge ${l.state}`}>{all.server.live[l.state]}</span>
                </td>
                <td className="nowrap">{l.memoryUsedMb !== undefined ? f.gb(l.memoryUsedMb) : "–"}</td>
                <td className={`nowrap${l.diskMb !== undefined && l.diskMb > diskLimitMb(s.plan) ? " over" : ""}`}>
                  {l.diskMb !== undefined ? `${f.size(l.diskMb)} / ${f.size(diskLimitMb(s.plan))}` : "–"}
                </td>
                <td className="nowrap">{s.plan !== "FREE" && s.paidUntil ? f.dateTime(s.paidUntil) : "–"}</td>
                <td className="nowrap">{f.date(s.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
