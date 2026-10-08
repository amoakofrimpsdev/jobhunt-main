// Rebuilds data/boards.json and data/h1b-sponsors.json from a jobleft checkout:
//   node scripts/build-data.mjs ../jobleft-main
// boards.json: jobleft's directory of employer boards (Greenhouse, Lever, Ashby); `verified` = jobleft saw it answer.
// h1b-sponsors.json: certified H-1B labor condition applications per employer, from the US Department of Labor's
// LCA disclosure data as jobleft compacted it. The key is companyKey(name), the same function src/lib/company.ts uses.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: node scripts/build-data.mjs <path to jobleft>");

const LEGAL = new Set(["inc", "incorporated", "llc", "corp", "corporation", "co", "company", "ltd", "limited", "llp", "lp", "plc", "pbc", "pc", "pllc", "gmbh", "ag", "sa", "bv", "nv", "pte", "pty"]);
export function companyKey(name) {
  let s = String(name ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[&+]/g, " and ").replace(/['’`]/g, "");
  s = s.replace(/(?<![\p{L}\p{N}])\p{L}(?:\.\s?\p{L})+\.?(?![\p{L}\p{N}])/gu, (m) => m.replace(/[.\s]/g, ""));
  const t = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let end = t.length, start = 0;
  while (end - start >= 2 && LEGAL.has(t[end - 1])) { end--; if (end - start >= 2 && t[end - 1] === "and") end--; }
  if (end - start >= 2 && t[start] === "the") start++;
  return t.slice(start, end).join("");
}

const dir = JSON.parse(readFileSync(join(root, "packages/boards/data/board-directory.json"), "utf8"));
const boards = dir.rows.filter((r) => !r.region).map((r) => ({ ats: r.ats, slug: r.slug, name: r.name.replace(/&amp;/g, "&"), verified: r.status === "live" }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync("data/boards.json", JSON.stringify({ source: `jobleft board directory ${dir.version}`, boards }));

const lines = gunzipSync(readFileSync(join(root, "packages/static-data/dist/h1b-lca.json.gz"))).toString("utf8").split("\n").filter(Boolean);
const header = JSON.parse(lines[0]);
const counts = {};
for (let i = 1; i <= header.counts.entities; i++) {
  const row = JSON.parse(lines[i]);
  const certified = row[5];
  if (!certified) continue;
  for (const name of [row[0], ...(row[12] ?? [])]) {
    const k = companyKey(name);
    if (k.length < 2) continue;
    counts[k] = Math.max(counts[k] ?? 0, certified);
  }
}
// Brand names whose filings sit under another legal name ("Ramp" files as "Ramp Business Corporation"): jobleft's
// hand-reviewed alias table. A brand gets the sum of its filers.
const aliases = JSON.parse(readFileSync(join(root, "packages/static-data/data/company-aliases.json"), "utf8"));
for (const e of aliases.entries) {
  const total = [...new Set(e.filers.map(companyKey))].reduce((n, k) => n + (counts[k] ?? 0), 0);
  if (!total) continue;
  for (const n of e.names) { const k = companyKey(n); if (k) counts[k] = Math.max(counts[k] ?? 0, total); }
}
writeFileSync("data/h1b-sponsors.json", JSON.stringify({
  source: header.meta.name, version: header.meta.version, window: header.meta.window, counts,
}));
console.log(`boards: ${boards.length}; H-1B employers: ${Object.keys(counts).length}`);
