#!/usr/bin/env node
// Generates the AndroidManifest <queries> block from the app registry so the
// manifest can never drift from the data. The registry test suite fails CI
// when they disagree; run this to regenerate:
//   node scripts/gen-android-queries.mjs        # print block
//   node scripts/gen-android-queries.mjs write  # patch AndroidManifest.xml
import { readFileSync, writeFileSync } from "node:fs";

const REG = "src/data/appRegistry.ts";
const MANIFEST = "android/app/src/main/AndroidManifest.xml";

// Same extraction rule as queryPackageIds(): active + verified + launchType
// package. Data is a pure literal, so a line-level parse is exact.
const src = readFileSync(REG, "utf8");
const pkgs = new Set(["com.android.vending"]);
// Entries are flat object literals (no nested braces) — scan block-wise so
// the parse survives any formatter.
for (const block of src.match(/\{[^{}]*\}/gs) ?? []) {
  if (!/launchType:\s*"package"/.test(block)) continue;
  if (!/verified:\s*true/.test(block)) continue;
  if (!/status:\s*"active"/.test(block)) continue;
  const m = block.match(/packageId:\s*"([^"]+)"/);
  if (m) pkgs.add(m[1]);
}

const inner = [...pkgs]
  .sort()
  .map((p) => `        <package android:name="${p}" />`)
  .join("\n");
const block = `    <!-- GENERATED from src/data/appRegistry.ts — run scripts/gen-android-queries.mjs -->
    <queries>
${inner}
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="upi" />
        </intent>
    </queries>`;

if (process.argv[2] === "write") {
  let xml = readFileSync(MANIFEST, "utf8");
  if (xml.includes("<queries>")) {
    xml = xml.replace(
      /[ \t]*<!-- GENERATED from src\/data\/appRegistry\.ts[^\n]*\n[ \t]*<queries>[\s\S]*?<\/queries>/,
      block,
    );
  } else {
    xml = xml.replace(/(\n\s*<\/manifest>)/, `\n${block}$1`);
  }
  writeFileSync(MANIFEST, xml);
  console.log(`wrote ${pkgs.size} <package> entries to ${MANIFEST}`);
} else {
  console.log(block);
}
