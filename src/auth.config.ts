import type { NextAuthConfig } from "next-auth";

/**
 * The part of the sign-in setup the middleware needs to read a session. It
 * runs on the edge, so nothing here may touch the database; src/auth.ts adds
 * the ways to sign in.
 */
export const authConfig = {
  session: { strategy: "jwt" },
  // A failed Google sign-in comes back to the log-in page with ?error=, which explains it.
  pages: { signIn: "/login", error: "/login" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.signedInAt = token.signedInAt;
      return session;
    },
  },
} satisfies NextAuthConfig;
