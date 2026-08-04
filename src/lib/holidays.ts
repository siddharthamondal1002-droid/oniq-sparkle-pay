// Public holidays via Nager.Date — MIT, no key, no rate limit, 100+ countries.
//
// WHY INDIA NEEDS SPECIAL HANDLING
//
// Nager returns two kinds of holiday: `global: true` ones that apply to the
// whole country, and subdivision-scoped ones carrying ISO 3166-2 codes on
// `counties` (e.g. "IN-WB" for West Bengal). For most countries the national
// list is the answer. For India it is actively wrong for most users — a
// Kolkata user's calendar without Durga Puja, or a Chennai user's without
// Pongal, is not a calendar they recognise.
//
// So: national holidays always, plus the user's own state's holidays when we
// know which state they are in. We never show one state's holidays to another
// state's user, because a wrong day off is worse than a missing one.

import type { Country } from "@/data/appRegistry";

export type Holiday = {
  date: string; // YYYY-MM-DD
  localName: string;
  name: string;
  /** true => nationwide. false => scoped to `subdivisions`. */
  national: boolean;
  /** ISO 3166-2 codes this holiday applies to, when not national. */
  subdivisions: string[];
};

type NagerHoliday = {
  date: string;
  localName: string;
  name: string;
  global: boolean;
  counties: string[] | null;
};

const BASE = "https://date.nager.at/api/v3";

/** Normalises Nager's shape into ours. Defensive: the API may add fields. */
export function normalise(raw: NagerHoliday[]): Holiday[] {
  return (raw ?? [])
    .filter((h) => typeof h?.date === "string")
    .map((h) => ({
      date: h.date,
      localName: h.localName ?? h.name ?? "",
      name: h.name ?? h.localName ?? "",
      national: h.global === true,
      subdivisions: Array.isArray(h.counties) ? h.counties : [],
    }));
}

/**
 * National holidays, plus the given subdivision's own.
 *
 * `subdivision` is a full ISO 3166-2 code ("IN-WB"), which is what Nager
 * returns. Passing null gives national holidays only — honest for a user
 * whose state we do not know, rather than guessing at one.
 */
export function filterForSubdivision(all: Holiday[], subdivision: string | null): Holiday[] {
  return all.filter((h) => {
    if (h.national) return true;
    if (!subdivision) return false;
    return h.subdivisions.includes(subdivision);
  });
}

/** Countries where the national list alone misleads more often than it helps. */
export const SUBDIVISION_SENSITIVE: Country[] = ["IN"];

export function needsSubdivision(country: Country): boolean {
  return SUBDIVISION_SENSITIVE.includes(country);
}

export async function fetchHolidays(
  year: number,
  country: Country,
  subdivision: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<Holiday[]> {
  const res = await fetchImpl(`${BASE}/PublicHolidays/${year}/${country}`);
  if (!res.ok) throw new Error(`holidays ${res.status}`);
  const raw = (await res.json()) as NagerHoliday[];
  return filterForSubdivision(normalise(raw), subdivision);
}

/** Next holiday on or after `from`, or null. */
export function nextHoliday(list: Holiday[], from: Date = new Date()): Holiday | null {
  const iso = from.toISOString().slice(0, 10);
  return [...list].sort((a, b) => a.date.localeCompare(b.date)).find((h) => h.date >= iso) ?? null;
}
