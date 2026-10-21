import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/credentials";
import { googleEnabled, googleUser } from "@/lib/googleAuth";
import { clearHits, clientIp, hit, loginKeys, loginLimited } from "@/lib/rateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email } = parsed.data;
        // Too many wrong passwords lately: refused without checking, so guessing gets nowhere.
        const ip = clientIp(request.headers);
        if (loginLimited(email, ip)) return null;
        const user = await db.user.findUnique({ where: { email } });
        // Accounts made with Google have no password until they set one.
        const ok = user?.passwordHash ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
        const keys = loginKeys(email, ip);
        if (!user || !ok) {
          hit(keys.email);
          hit(keys.ip);
          return null;
        }
        clearHits(keys.email);
        return { id: user.id, email: user.email };
      },
    }),
    // Reads AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from deploy/.env.
    ...(googleEnabled ? [Google] : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      // Finds, links or creates the account; refuses an email Google hasn't confirmed.
      return Boolean(await googleUser(account.providerAccountId, profile?.email, profile?.email_verified));
    },
    async jwt({ token, user, account }) {
      // user is only set when signing in.
      if (account?.provider === "google") {
        // Google's own id isn't ours: use the account signIn found or made.
        const linked = await db.user.findUnique({
          where: { googleId: account.providerAccountId },
          select: { id: true, email: true },
        });
        if (!linked) return null;
        token.sub = linked.id;
        token.email = linked.email;
        token.signedInAt = Date.now();
      } else if (user?.id) {
        token.sub = user.id;
        token.signedInAt = Date.now();
      }
      return token;
    },
  },
});
