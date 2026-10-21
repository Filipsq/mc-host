import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Only reads the session, so it uses the database-free part of the setup.
export const { auth: middleware } = NextAuth(authConfig);

export const config = { matcher: ["/dashboard/:path*"] };
