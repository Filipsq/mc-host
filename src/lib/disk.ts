import type { Plan } from "@prisma/client";
import { planById } from "./plans";

// A server's files may take its plan's disk space. The agent enforces it (see
// agent/disk.go): uploads can't go over, and a server the game grows more than
// a tenth past it is stopped until its owner makes room.

/** The plan's disk space in MB, as the agent is told. */
export const diskLimitMb = (plan: Plan) => planById(plan).diskGb * 1024;

/** Where the agent stops a server: a tenth over its limit (hardDiskLimit in the agent). */
export const hardDiskLimitMb = (limitMb: number) => limitMb + Math.floor(limitMb / 10);

/** "350 MB", "1.2 GB": megabytes under a gigabyte, else gigabytes to one decimal. */
export function formatMb(mb: number, locale: string) {
  const gb = mb >= 1024;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: gb ? "gigabyte" : "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: gb ? 1 : 0,
  }).format(gb ? mb / 1024 : mb);
}
