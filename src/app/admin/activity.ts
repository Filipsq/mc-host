import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { REFUSAL_KINDS, type RefusalKind } from "@/lib/refusals";

const DAY = 24 * 60 * 60 * 1000;

/** Today (since midnight, Polish time), the last 7 and the last 30 days. */
export function windows(now: Date) {
  return [warsawMidnight(now), new Date(now.getTime() - 7 * DAY), new Date(now.getTime() - 30 * DAY)] as const;
}

export type Counts = [number, number, number];

export const countSince = (dates: Date[], since: readonly Date[]): Counts => since.map((s) => dates.filter((d) => d >= s).length) as Counts;

// Real money only: no test payments (cs_test_, also admins' 0 zł buys) and no gift codes (amount 0).
const REAL_PAID = {
  status: "PAID",
  amount: { gt: 0 },
  OR: [{ stripeSessionId: null }, { NOT: { stripeSessionId: { startsWith: "cs_test_" } } }],
} satisfies Prisma.PaymentWhereInput;

/** What happened lately on the site, and who was turned away, for the admin overview. */
export async function activity(now: Date) {
  const since = windows(now);
  const [refusals, firstPaid, payments, freeServers] = await Promise.all([
    db.refusal.findMany({ where: { createdAt: { gte: since[2] } }, orderBy: { createdAt: "desc" } }),
    // Each paying customer's first real payment.
    db.payment.groupBy({ by: ["userId"], where: REAL_PAID, _min: { paidAt: true } }),
    db.payment.findMany({ where: { ...REAL_PAID, paidAt: { gte: since[2] } }, select: { paidAt: true } }),
    db.server.findMany({ where: { plan: "FREE", adminTest: false, createdAt: { gte: since[2] } }, select: { createdAt: true } }),
  ]);

  const byKind = Object.fromEntries(
    REFUSAL_KINDS.map((kind) => {
      const rows = refusals.filter((r) => r.kind === kind);
      return [kind, { counts: countSince(rows.map((r) => r.createdAt), since), people: new Set(rows.map((r) => r.userId)).size }];
    }),
  ) as Record<RefusalKind, { counts: Counts; people: number }>;

  const recent = refusals.slice(0, 10);
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(recent.map((r) => r.userId).filter((id): id is string => !!id))] } },
    select: { id: true, email: true },
  });
  const email = new Map(users.map((u) => [u.id, u.email]));

  return {
    since,
    refusals: byKind,
    recent: recent.map((r) => ({ ...r, kind: r.kind as RefusalKind, email: r.userId ? email.get(r.userId) : undefined })),
    newFree: countSince(freeServers.map((s) => s.createdAt), since),
    newPaying: countSince(firstPaid.map((p) => p._min.paidAt).filter((d): d is Date => !!d), since),
    payments: countSince(payments.map((p) => p.paidAt!), since),
    paying: firstPaid.length,
  };
}

/** Midnight of the given day (default: today), Polish time. */
export function warsawMidnight(now: Date, day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(now)) {
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Warsaw", timeZoneName: "longOffset" }).formatToParts(
    new Date(`${day}T12:00:00Z`),
  );
  const zone = offset.find((p) => p.type === "timeZoneName")!.value.replace("GMT", "") || "Z";
  return new Date(`${day}T00:00:00${zone}`);
}
