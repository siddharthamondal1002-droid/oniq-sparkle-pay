/**
 * OQCA v1.1 — a deterministic content hash.
 *
 * WHY NOT `crypto`. The v1.1 brief requires `hash()` and deterministic replay.
 * Node's `crypto` and Web Crypto disagree on API shape and Web Crypto's digest
 * is ASYNC, which would make `hash()` a promise and every state construction
 * await-ed. This is an integrity tag for a research log, not a security
 * primitive: it must be identical on every runtime and cheap enough to compute
 * on every transition. It is NOT collision-resistant against an adversary and
 * `OQCA_CLAIMS.md` says so.
 *
 * FNV-1a over a CANONICAL serialisation, twice with different offsets, to give
 * 128 bits of tag. The canonicalisation is the load-bearing half: two states
 * that differ only in key order must hash the same, and two that differ in the
 * last bit of one amplitude must not.
 */

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, offset: number): number {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    h ^= (text.charCodeAt(i) >>> 8) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * A stable string for any JSON-ish value: object keys sorted, numbers written
 * at full precision so two amplitudes that differ in the last ulp do not
 * collapse to the same text.
 *
 * -0 IS NORMALISED TO 0 DELIBERATELY. `Object.is(-0, 0)` is false and
 * `(-0).toPrecision(17)` is "-0.0000..." — so a phase rotation that lands an
 * amplitude on negative zero would change a state's hash without changing the
 * state. Every comparison this hash feeds treats them as equal, so the
 * serialisation must too.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return JSON.stringify(String(value));
    return (value === 0 ? 0 : value).toPrecision(17);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** A 32-hex-character tag. Deterministic across runtimes and process runs. */
export function contentHash(value: unknown): string {
  const text = canonicalJson(value);
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, 0x01000193);
  const d = fnv1a(`${text}|${text.length}`, 0xcbf29ce4);
  const e = fnv1a(`${text.length}|${text}`, 0x9e3779b9);
  return [a, b, d, e].map((n) => n.toString(16).padStart(8, "0")).join("");
}
