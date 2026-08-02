// Country-aware mental-health crisis lines — hard-coded, verified numbers.
// NEVER behind a paywall, login wall or onboarding step. Shown with the
// line's name, tap-to-call. Re-verify numbers periodically.

import type { Country } from "@/data/appRegistry";

export type CrisisLine = { name: string; number: string; note?: string };

export const CRISIS_LINES: Record<Country, CrisisLine[]> = {
  IN: [
    {
      name: "Tele-MANAS — 24/7 mental health support",
      number: "14416",
      note: "free · ~20 languages",
    },
    { name: "Tele-MANAS toll-free", number: "18008914416" },
  ],
  US: [{ name: "988 Suicide & Crisis Lifeline", number: "988", note: "call or text · 24/7" }],
  GB: [
    { name: "Samaritans", number: "116123", note: "free · 24/7" },
    { name: "NHS urgent mental health", number: "111" },
  ],
  CA: [{ name: "9-8-8 Suicide Crisis Helpline", number: "988", note: "call or text · 24/7" }],
  AU: [
    { name: "Lifeline", number: "131114", note: "24/7" },
    { name: "Beyond Blue", number: "1300224636" },
  ],
  AE: [
    { name: "Estijaba support line", number: "8001717" },
    { name: "MOHAP support", number: "8004673" },
  ],
  SG: [
    { name: "Samaritans of Singapore (SOS)", number: "1767", note: "24/7" },
    { name: "mindline.sg", number: "1771" },
  ],
};

export const CRISIS_EMERGENCY: Record<Country, string> = {
  IN: "112",
  US: "911",
  GB: "999",
  CA: "911",
  AU: "000",
  AE: "999",
  SG: "995",
};
