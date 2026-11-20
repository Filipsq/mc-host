import type { NextConfig } from "next";

// Sent with every page on top of Caddy's (deploy/Caddyfile), so they also apply
// when the site runs without it. The policy only limits what can't break the
// site: no plugins, no <base> tricks, no framing by other sites, and no
// browser features the site never uses (camera, microphone, location...).
const securityHeaders = [
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  // Don't tell visitors (and scanners) which framework the site runs on.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
