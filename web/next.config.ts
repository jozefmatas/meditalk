import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import createNextIntlPlugin from "next-intl/plugin";

// Create next-intl plugin with request handler path
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Return the first non-internal IPv4 address (i.e. the current LAN IP). */
function getLocalIp(): string | undefined {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return undefined;
}

// ── Security headers ────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' required for Next.js inline scripts; 'unsafe-eval' only in dev (HMR)
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com wss://*.elevenlabs.io${isDev ? " ws: wss: http://localhost:* https://localhost:*" : ""}`,
  "media-src 'self' blob: https://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
  // Allow Capacitor dev: the simulator/device connects via LAN IP.
  // Auto-detect so it works on any network without manual edits.
  allowedDevOrigins: ["localhost", getLocalIp()].filter(Boolean) as string[],
};

export default withNextIntl(nextConfig);
