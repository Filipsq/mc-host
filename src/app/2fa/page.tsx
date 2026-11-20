import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { newSecret, otpauthUrl } from "@/lib/totp";
import { BRAND_NAME } from "@/lib/brand";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import TwoFactorForm from "./TwoFactorForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).twoFactor.title, robots: { index: false } };
}

/** An admin's second step: setting up the authenticator app the first time, then a code once per sign-in. */
export default async function TwoFactorPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  let user = await db.user.findUnique({ where: { id: userId }, select: { admin: true, email: true, totpSecret: true, totpEnabledAt: true } });
  if (!user?.admin) notFound();
  if (await isAdmin(userId)) redirect("/admin");
  // The first visit makes the secret; it stays the same until a right code turns it on.
  if (!user.totpSecret) {
    await db.user.updateMany({ where: { id: userId, totpSecret: null }, data: { totpSecret: newSecret() } });
    user = await db.user.findUnique({ where: { id: userId }, select: { admin: true, email: true, totpSecret: true, totpEnabledAt: true } });
    if (!user?.totpSecret) notFound();
  }
  const t = (await getMessages()).twoFactor;
  const setup = !user.totpEnabledAt;
  // Made on our server from the account's own secret, not from anyone's input.
  const qr = setup
    ? await QRCode.toString(otpauthUrl(user.totpSecret!, user.email, BRAND_NAME), {
        type: "svg",
        margin: 1,
        color: { dark: "#0b0f14", light: "#ffffff" },
      })
    : null;
  return (
    <main className="wide-form stack">
      <h1>{t.title}</h1>
      <p className="muted">{setup ? t.setupIntro : t.verifyIntro}</p>
      {qr && (
        <div className="card stack">
          <span style={{ display: "block", maxWidth: 220 }} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="muted small">{t.manual}</p>
          <code style={{ wordBreak: "break-all" }}>{user.totpSecret!.replace(/(.{4})/g, "$1 ").trim()}</code>
        </div>
      )}
      <TwoFactorForm t={t} setup={setup} />
      <p className="muted small">{format(t.lost, { email: user.email })}</p>
    </main>
  );
}
