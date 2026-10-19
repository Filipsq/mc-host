import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/credentials";
import { clearHits, clientIp, hit, loginKeys, loginLimited } from "@/lib/rateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
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
        const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
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
  ],
  callbacks: {
    jwt({ token, user }) {
      // user is only set when signing in.
      if (user?.id) {
        token.sub = user.id;
        token.signedInAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.signedInAt = token.signedInAt;
      return session;
    },
  },
});
