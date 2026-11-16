import "server-only";
import { db } from "@/lib/db";
import { destroyServer } from "@/lib/servers";
import { stripe } from "@/lib/stripe";

/**
 * Deleting a whole account (admin user page, or the customer on /dashboard/konto).
 *
 * Servers go first, with their containers, files and backups on their machines
 * (destroyServer). If one of them can't be removed, nothing else is touched, so
 * the account can be deleted again once the machine answers.
 *
 * Paid payments must be kept for the tax office (privacy policy §5: five years),
 * so an account with any of them stays as an empty, anonymous row: no email,
 * no password, no Google link, no Stripe customer, and its payments keep only
 * amounts and dates. An account that never paid is removed completely.
 */

/** What the confirmation shows before deleting: servers still paid for, and how many servers in all. */
export async function accountSummary(userId: string) {
  const now = new Date();
  const servers = await db.server.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, plan: true, paidUntil: true, autoRenew: true },
    orderBy: { createdAt: "asc" },
  });
  const paid = servers.filter((s) => s.plan !== "FREE" && s.paidUntil && s.paidUntil > now);
  return { servers: servers.length, paid };
}

export type DeleteResult = "deleted" | "anonymized" | "serverFailed" | "missing" | "admin";

export async function deleteAccount(userId: string): Promise<DeleteResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, admin: true, deletedAt: true, stripeCustomerId: true },
  });
  if (!user || user.deletedAt) return "missing";
  // An admin is made and unmade with deploy/admin.sh; remove that first, so nobody deletes the last admin by a slip.
  if (user.admin) return "admin";

  const servers = await db.server.findMany({ where: { ownerId: userId }, select: { id: true } });
  for (const s of servers) {
    try {
      await destroyServer(s);
    } catch (err) {
      console.error("account deletion: server not removed", userId, s.id, err);
      return "serverFailed";
    }
  }

  // Checkouts left open can't be paid any more (they'd take money for nothing).
  const pending = await db.payment.findMany({ where: { userId, status: "PENDING" }, select: { id: true, stripeSessionId: true } });
  for (const p of pending) {
    if (p.stripeSessionId && !p.stripeSessionId.startsWith("cs_test_admin_")) {
      await stripe()
        .checkout.sessions.expire(p.stripeSessionId)
        .catch((err) => console.warn("account deletion: checkout not expired", p.id, err?.message ?? err));
    }
  }
  await db.payment.updateMany({ where: { userId, status: "PENDING" }, data: { status: "EXPIRED" } });

  // Saved cards go with the Stripe customer; its past payments stay in Stripe.
  if (user.stripeCustomerId) {
    await stripe()
      .customers.del(user.stripeCustomerId)
      .catch((err) => console.warn("account deletion: Stripe customer not deleted", userId, err?.message ?? err));
  }

  const keep = (await db.payment.count({ where: { userId, status: "PAID" } })) > 0;

  await db.$transaction(async (tx) => {
    // Friends' servers they were let into, also invites to this email not accepted yet.
    await tx.serverMember.deleteMany({ where: { OR: [{ userId }, { email: user.email }] } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.supportChat.deleteMany({ where: { userId } });
    await tx.review.deleteMany({ where: { userId } });
    await tx.aiUsage.deleteMany({ where: { userId } });
    // People they invited keep their accounts, just not the link to this one.
    await tx.user.updateMany({ where: { referredById: userId }, data: { referredById: null } });

    if (!keep) {
      // Never paid: nothing has to be kept. Failed and expired payments and unpaid gift codes go with the row.
      await tx.user.delete({ where: { id: userId } });
      return;
    }
    // Only paid payments are kept; gift codes they paid for still work for whoever got them.
    await tx.payment.deleteMany({ where: { userId, status: { not: "PAID" } } });
    await tx.giftCode.deleteMany({ where: { buyerId: userId, paidAt: null } });
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymousEmail(userId),
        passwordHash: null,
        googleId: null,
        stripeCustomerId: null,
        referralCode: null,
        referredById: null,
        // Every session still open is signed out (src/lib/session.ts).
        passwordChangedAt: new Date(),
        deletedAt: new Date(),
        bonusDays: 0,
        freeStarters: 0,
        apologyDays: 0,
        startOfferAt: null,
        comebackOff: true,
        reviewDismissedAt: null,
      },
    });
  });
  return keep ? "anonymized" : "deleted";
}

/** The email a deleted account keeps: nobody can sign in with it or get mail at it (.invalid never resolves). */
export function anonymousEmail(userId: string) {
  return `usuniete-${userId}@usuniete.invalid`;
}
