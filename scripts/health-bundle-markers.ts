// scripts/health-bundle-markers.ts — is the Health AI admin screen in the
// bundle that is served? (oniq-ship: the marker lives in the ROUTE chunk, so a
// grep of the entry bundle answers nothing.)
//
//   npx tsx scripts/health-bundle-markers.ts                        local build (.output/public/assets)
//   npx tsx scripts/health-bundle-markers.ts --dir dist/client/assets
//   npx tsx scripts/health-bundle-markers.ts --url https://oniqhub.com   the SERVED bundle
//
// Exit 0: every marker is in the chunk it belongs to, and none is in the entry.
// Exit 1: a marker is missing, or in the wrong chunk — a stale or mis-split
//         build; do not call the publish verified.
// Exit 2: the bundle could not be reached. UNVERIFIED is not STALE: from the
//         dev container oniqhub.com answers the proxy's 403, and the right
//         reading of that is "run this from somewhere that can reach it".
//
// src/health/__tests__/productionCheck.test.ts pins ROUTE_MARKERS to the
// data-testids in the route file and the privacy sentence to privacy.tsx, so a
// renamed control or a reworded promise fails the test before it fails here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HEALTH_AI_PRIVACY_SENTENCES, HEALTH_AI_RECIPIENT_SENTENCE } from "../src/config/privacy";

export const ROUTE_CHUNK = /^app\.admin_\.health-ai-[\w-]+\.js$/;
/**
 * Phase 3b (owner directive 2026-09-09, "A, B and C"): the Records screen
 * carries the upload control and the read-method note. The note's English
 * default is a literal that existed in NO earlier build, so a 1 cannot be a
 * leftover; the two data-testids are the upload input and the Explain button.
 */
export const RECORDS_CHUNK = /^app\.health\.records-[\w-]+\.js$/;
export const RECORDS_MARKERS = [
  "health-doc-input",
  "health-doc-extract",
  "was sent to Google Cloud Vertex AI (Gemini) to be read",
];
export const ROUTE_MARKERS = [
  "health-ai-admin-kill",
  "health-ai-admin-unkill",
  "health-ai-admin-caps-save",
  "health-ai-admin-house-cap",
];
export const PRIVACY_CHUNK = /^privacy-[\w-]+\.js$/;
/**
 * The two sentences of the health-AI disclosure (owner directive 2026-09-09),
 * each a marker of its own, plus a FRAGMENT of the Phase 3 recipient sentence:
 * the notice renders the recipient's name in a <strong>, so the bundle carries
 * the sentence as three text nodes and only a fragment survives as one literal.
 * The fragment is derived from the constant, so a reworded sentence moves it.
 */
export const RECIPIENT_FRAGMENT = HEALTH_AI_RECIPIENT_SENTENCE.slice(
  HEALTH_AI_RECIPIENT_SENTENCE.indexOf(", operated by Google") + 2,
);
export const PRIVACY_SENTENCES = [...HEALTH_AI_PRIVACY_SENTENCES, RECIPIENT_FRAGMENT];
/** The absolute claim that disclosure replaced; in a served chunk it means the build is STALE. */
export const OLD_PRIVACY_CLAIM = "never sent to any AI";
export const ENTRY_CHUNK = /^index-[\w-]+\.js$/;

function count(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

export type Verdict = { ok: boolean; line: string };

/** Given {name -> text} for the chunks that matter, return one verdict per marker. */
export function check(chunks: Record<string, string>): Verdict[] {
  const out: Verdict[] = [];
  const routeChunks = Object.keys(chunks).filter((n) => ROUTE_CHUNK.test(n));
  if (routeChunks.length === 0)
    out.push({ ok: false, line: `route chunk app.admin_.health-ai-*.js  ABSENT` });
  for (const name of routeChunks) {
    for (const m of ROUTE_MARKERS) {
      const c = count(chunks[name], m);
      out.push({ ok: c >= 1, line: `${m.padEnd(28)} ${name}  ${c}` });
    }
  }
  const recordsChunks = Object.keys(chunks).filter((n) => RECORDS_CHUNK.test(n));
  if (recordsChunks.length === 0) {
    out.push({ ok: false, line: `records chunk app.health.records-*.js  ABSENT` });
  }
  for (const name of recordsChunks) {
    for (const m of RECORDS_MARKERS) {
      const c = count(chunks[name], m);
      out.push({ ok: c >= 1, line: `${m}  ${name}  ${c}` });
    }
  }
  const privacyChunks = Object.keys(chunks).filter((n) => PRIVACY_CHUNK.test(n));
  if (privacyChunks.length === 0)
    out.push({ ok: false, line: `privacy chunk privacy-*.js  ABSENT` });
  for (const sentence of PRIVACY_SENTENCES) {
    const hits: Array<[string, number]> = privacyChunks.map((n) => [n, count(chunks[n], sentence)]);
    out.push({
      ok: hits.some(([, c]) => c >= 1),
      line: `privacy "${sentence.slice(0, 38)}…"  ${hits.map(([n, c]) => `${n}=${c}`).join(" ")}`,
    });
  }
  const entryChunks = Object.keys(chunks).filter((n) => ENTRY_CHUNK.test(n));
  for (const name of [...privacyChunks, ...entryChunks]) {
    const c = count(chunks[name], OLD_PRIVACY_CLAIM);
    out.push({ ok: c === 0, line: `old claim "${OLD_PRIVACY_CLAIM}" ABSENT   ${name}  ${c}` });
  }
  for (const name of Object.keys(chunks).filter((n) => ENTRY_CHUNK.test(n))) {
    const c = count(chunks[name], ROUTE_MARKERS[0]);
    out.push({ ok: c === 0, line: `${ROUTE_MARKERS[0]} NOT in entry   ${name}  ${c}` });
  }
  return out;
}

function fromDir(dir: string): Record<string, string> {
  const chunks: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (
      ROUTE_CHUNK.test(name) ||
      RECORDS_CHUNK.test(name) ||
      PRIVACY_CHUNK.test(name) ||
      ENTRY_CHUNK.test(name)
    ) {
      chunks[name] = readFileSync(join(dir, name), "utf8");
    }
  }
  return chunks;
}

async function fromUrl(base: string): Promise<Record<string, string>> {
  const root = base.replace(/\/$/, "");
  const html = await (await fetch(`${root}/`)).text();
  const entry = html.match(/\/assets\/(index-[\w-]+\.js)/);
  if (!entry) throw new Error("no /assets/index-*.js reference in the served HTML");
  const entryText = await (await fetch(`${root}/assets/${entry[1]}`)).text();
  const chunks: Record<string, string> = { [entry[1]]: entryText };
  const wanted = new Set<string>();
  for (const m of entryText.matchAll(
    /(app\.admin_\.health-ai-[\w-]+\.js|app\.health\.records-[\w-]+\.js|privacy-[\w-]+\.js)/g,
  ))
    wanted.add(m[1]);
  for (const name of wanted) chunks[name] = await (await fetch(`${root}/assets/${name}`)).text();
  return chunks;
}

const args = process.argv.slice(2);
const argOf = (flag: string): string | undefined =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = argOf("--url");
  const dir = argOf("--dir") ?? ".output/public/assets";
  let chunks: Record<string, string>;
  try {
    chunks = url ? await fromUrl(url) : fromDir(dir);
  } catch (e) {
    console.log(`UNVERIFIED: could not read the bundle (${url ?? dir}): ${(e as Error).message}`);
    process.exit(2);
  }
  console.log(`source: ${url ?? dir}`);
  for (const [name, text] of Object.entries(chunks))
    console.log(`  ${name}  ${Buffer.byteLength(text)} bytes`);
  const results = check(chunks);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.line}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
