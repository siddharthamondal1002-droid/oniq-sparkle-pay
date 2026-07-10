import type { CapacitorConfig } from "@capacitor/cli";

// Thin native wrapper — the Play Store app always loads live production
// so shipped builds pick up server-side updates without a store review.
const config: CapacitorConfig = {
  appId: "com.oniqhub.app",
  appName: "ONIQ",
  webDir: "dist",
  server: {
    url: "https://oniqhub.com",
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
