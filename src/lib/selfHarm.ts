/**
 * On-device self-harm signal detection (L4, care-first). High-precision
 * phrase list only — a match surfaces support resources; it NEVER blocks,
 * deletes, or reports the content, and nothing is sent to any external
 * service. Detection runs entirely on the user's device.
 */
const PHRASES: RegExp[] = [
  /\bkill(?:ing)? myself\b/i,
  /\bend(?:ing)? my life\b/i,
  /\bwant(?:ing)? to die\b/i,
  /\bsuicide\b/i,
  /\bsuicidal\b/i,
  /\bself[- ]?harm\b/i,
  /\bno reason to live\b/i,
  /\bbetter off without me\b/i,
  /\bcan'?t go on\b/i,
  // Hindi / Hinglish (conservative)
  /\bkhudkushi\b/i,
  /\batma\s*hatya\b/i,
  /\bmarna chaht[ai] hu\b/i,
  /\bjeena nahi chaht[ai]\b/i,
  // Bengali (romanised, conservative)
  /\batmohotta\b/i,
  /\bmore jete chai\b/i,
];

export function detectSelfHarmSignal(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.slice(0, 2000);
  return PHRASES.some((re) => re.test(t));
}

export const CRISIS_LINES = [
  { name: "Tele-MANAS (Govt. of India, 24×7)", tel: "14416", alt: "1-800-891-4416" },
  { name: "KIRAN helpline", tel: "18005990019", alt: "1800-599-0019" },
] as const;
