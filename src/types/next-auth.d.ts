import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    // When this session signed in (ms), to end sessions older than a password change.
    signedInAt?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    signedInAt?: number;
  }
}
