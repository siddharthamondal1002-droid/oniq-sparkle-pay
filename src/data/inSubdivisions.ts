// ISO 3166-2:IN subdivision codes, for state-level public holidays.
//
// Nager.Date returns these on a holiday's `counties` field, so they are the
// join key between "which state is this user in" and "which holidays apply".
// The national list alone is wrong for most Indian users — a Kolkata calendar
// without Durga Puja, or a Chennai one without Pongal, is not a calendar they
// recognise.
//
// Codes only. No coordinates, nothing derived from location hardware: the user
// picks their state and it stays on the device, the same posture as
// currentRegion.

export type InSubdivision = { code: string; name: string };

export const IN_SUBDIVISIONS: InSubdivision[] = [
  { code: "IN-AN", name: "Andaman & Nicobar Islands" },
  { code: "IN-AP", name: "Andhra Pradesh" },
  { code: "IN-AR", name: "Arunachal Pradesh" },
  { code: "IN-AS", name: "Assam" },
  { code: "IN-BR", name: "Bihar" },
  { code: "IN-CH", name: "Chandigarh" },
  { code: "IN-CT", name: "Chhattisgarh" },
  { code: "IN-DH", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "IN-DL", name: "Delhi" },
  { code: "IN-GA", name: "Goa" },
  { code: "IN-GJ", name: "Gujarat" },
  { code: "IN-HP", name: "Himachal Pradesh" },
  { code: "IN-HR", name: "Haryana" },
  { code: "IN-JH", name: "Jharkhand" },
  { code: "IN-JK", name: "Jammu & Kashmir" },
  { code: "IN-KA", name: "Karnataka" },
  { code: "IN-KL", name: "Kerala" },
  { code: "IN-LA", name: "Ladakh" },
  { code: "IN-LD", name: "Lakshadweep" },
  { code: "IN-MH", name: "Maharashtra" },
  { code: "IN-ML", name: "Meghalaya" },
  { code: "IN-MN", name: "Manipur" },
  { code: "IN-MP", name: "Madhya Pradesh" },
  { code: "IN-MZ", name: "Mizoram" },
  { code: "IN-NL", name: "Nagaland" },
  { code: "IN-OR", name: "Odisha" },
  { code: "IN-PB", name: "Punjab" },
  { code: "IN-PY", name: "Puducherry" },
  { code: "IN-RJ", name: "Rajasthan" },
  { code: "IN-SK", name: "Sikkim" },
  { code: "IN-TG", name: "Telangana" },
  { code: "IN-TN", name: "Tamil Nadu" },
  { code: "IN-TR", name: "Tripura" },
  { code: "IN-UP", name: "Uttar Pradesh" },
  { code: "IN-UT", name: "Uttarakhand" },
  { code: "IN-WB", name: "West Bengal" },
];

const KEY = "oniq.in.subdivision";

/** Device-only, like currentRegion. Never written to Supabase. */
export function getSubdivision(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return IN_SUBDIVISIONS.some((s) => s.code === v) ? v : null;
  } catch {
    return null;
  }
}

export function setSubdivision(code: string | null): void {
  try {
    if (code === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch {
    /* noop */
  }
}
