// Native (Capacitor) phone-contacts bridge to ContactsBridgePlugin.
// Web builds return { available: false }; native builds prompt the
// system READ_CONTACTS dialog and return normalized contact rows.

export type NativeContact = { name: string; phones: string[] };

export async function isNativeContactsAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function getNativeContacts(): Promise<
  { ok: true; contacts: NativeContact[] } | { ok: false; denied: boolean; message: string }
> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    // registerPlugin gives us a proxy that invokes the native side.
    const plugin = Capacitor.registerPlugin<{
      getContacts: () => Promise<{ contacts: NativeContact[] }>;
    }>("ContactsBridge");
    const res = await plugin.getContacts();
    const contacts = Array.isArray(res?.contacts) ? res.contacts : [];
    return { ok: true, contacts };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e ?? "");
    const denied = /denied/i.test(msg);
    return { ok: false, denied, message: msg || "contacts unavailable" };
  }
}

// Last-10-digits normalization mirrors the server-side match_contacts RPC.
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D+/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}
