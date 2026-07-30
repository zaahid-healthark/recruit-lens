import Constants from "expo-constants";

/**
 * API endpoint configuration.
 *
 * Preferred: set EXPO_PUBLIC_API_BASE_URL / EXPO_PUBLIC_API_KEY in mobile/.env
 * (see mobile/.env.example). Values are inlined at bundle time — restart the
 * dev server after changing them. Fallbacks: app.json → expo.extra, then the
 * Android-emulator default below.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; apiKey?: string };

// 10.0.2.2 reaches the dev machine's localhost from the Android emulator.
// On a physical device use your PC's LAN IP, e.g. http://192.168.1.50:4000
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || "http://10.0.2.2:4000";

export const API_KEY: string =
  process.env.EXPO_PUBLIC_API_KEY || extra.apiKey || "dev-secret-change-me";
