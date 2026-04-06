import type { CapacitorConfig } from "@capacitor/cli";
import { config as dotenvConfig } from "dotenv";

// Capacitor CLI doesn't load Next.js .env files — load .env.local manually.
dotenvConfig({ path: ".env.local" });

const CAP_DEV_PORT = 8111;

// "auto" → detect LAN IP automatically (works across networks)
// explicit URL → use as-is (e.g. https://app.meditalk.ai for prod)
// unset → no server URL (local webDir assets)
const raw = process.env.CAP_SERVER_URL;
// "auto" → http://localhost:<port> — secure context without HTTPS.
//   iOS Simulator: localhost = host machine (works directly)
//   Android Emulator: requires `adb forward tcp:<port> tcp:<port>`
const serverUrl = raw === "auto" ? `http://localhost:${CAP_DEV_PORT}` : raw;

const config: CapacitorConfig = {
  appId: "ai.meditalk.app",
  appName: "MediTalk",
  // Minimal fallback assets — the WebView loads from server.url instead.
  webDir: "cap-assets",

  server: {
    // Dev:  CAP_SERVER_URL=auto  (auto-detects LAN IP with HTTPS)
    // Prod: CAP_SERVER_URL=https://app.meditalk.ai
    ...(serverUrl && {
      url: serverUrl,
      cleartext: serverUrl.startsWith("http://"),
    }),
    // Keep localhost for secure-context APIs (getUserMedia, etc.)
    hostname: "localhost",
    androidScheme: "https",
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#f9f8f5",
      showSpinner: false,
    },
  },

  ios: {
    contentInset: "automatic",
    backgroundColor: "#f9f8f5",
  },

  android: {
    backgroundColor: "#f9f8f5",
  },
};

export default config;
