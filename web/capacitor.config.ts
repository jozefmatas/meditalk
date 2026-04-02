import type { CapacitorConfig } from "@capacitor/cli";
import { config as dotenvConfig } from "dotenv";

// Capacitor CLI doesn't load Next.js .env files — load .env.local manually.
dotenvConfig({ path: ".env.local" });

const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "ai.meditalk.app",
  appName: "MediTalk",
  // Minimal fallback assets — the WebView loads from server.url instead.
  webDir: "cap-assets",

  server: {
    // The native app always loads from a server URL (no static export).
    // Dev:  CAP_SERVER_URL=http://192.168.x.x:8111
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
      backgroundColor: "#4945ff",
      showSpinner: false,
    },
  },

  ios: {
    contentInset: "automatic",
    backgroundColor: "#ffffff",
  },

  android: {
    backgroundColor: "#ffffff",
  },
};

export default config;
