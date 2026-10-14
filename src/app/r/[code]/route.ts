import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, inviterFor } from "@/lib/referrals";

/** An invite link: remembers who sent it (until sign-up), then shows the home page. */
export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  // Relative, so it stays on whatever address the visitor used.
  const res = new Response(null, { status: 307, headers: { Location: "/" } });
  if (await inviterFor(code)) {
    res.headers.append(
      "Set-Cookie",
      `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_COOKIE_DAYS * 24 * 60 * 60}; HttpOnly; SameSite=Lax`,
    );
  }
  return res;
}
