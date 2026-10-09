// Rebuilds data/collections.json from a jobleft data folder: the job collections followed there (a venture firm's
// portfolio board, a Simplify list) and the employer boards jobleft found behind each one.
//   node scripts/import-jobleft-collections.mjs [path to jobleft.db]
// Only boards Jobhunt has a reader for are kept (US hosts of Greenhouse, Lever and Ashby, and Workday, Workable,
// iCIMS, Oracle, JazzHR and BambooHR); the rest are counted in
// `notRead` so Sources can say what is missing. Collections added by hand (data/collections-extra.json) are merged in.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = process.argv[2] ?? join(homedir(), "Library/Application Support/jobleft/data/jobleft.db");
const db = new DatabaseSync(file, { readOnly: true });
const READABLE = new Set(["greenhouse", "lever", "ashby", "workday", "workable", "icims", "oracle", "jazzhr", "bamboohr"]);
const DIRECT = { id: "jobleft", name: "Followed in jobleft", url: "" };

const collections = [...db.prepare("SELECT id, name, url FROM srv_collections ORDER BY added_at").all(), DIRECT]
  .map((c) => ({ id: c.id, name: c.name, url: c.url, notRead: {} }));
const index = new Map(collections.map((c, i) => [c.id, i]));
const boards = new Map();
for (const r of db.prepare("SELECT ats, board, region, company, collection FROM srv_boards WHERE followed = 1 AND disabled = 0 AND hidden = 0").all()) {
  const c = collections[index.get(r.collection ?? DIRECT.id) ?? index.get(DIRECT.id)];
  if (!READABLE.has(r.ats) || r.region) { c.notRead[r.ats] = (c.notRead[r.ats] ?? 0) + 1; continue; }
  const key = `${r.ats}:${r.board.toLowerCase()}`;
  const b = boards.get(key) ?? { ats: r.ats, slug: r.board, name: r.company, in: [] };
  b.in.push(c.id);
  boards.set(key, b);
}

const extraFile = "data/collections-extra.json";
if (existsSync(extraFile)) {
  const extra = JSON.parse(readFileSync(extraFile, "utf8"));
  for (const c of extra.collections) collections.push({ id: c.id, name: c.name, url: c.url, notRead: {}, fixed: c.fixed === true });
  for (const x of extra.boards) {
    const key = `${x.ats}:${x.slug.toLowerCase()}`;
    const b = boards.get(key) ?? { ats: x.ats, slug: x.slug, name: x.name, in: [] };
    b.in.push(...x.in);
    boards.set(key, b);
  }
}

const out = [...boards.values()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync("data/collections.json", JSON.stringify({ collections, boards: out }));
for (const c of collections) {
  const n = out.filter((b) => b.in.includes(c.id)).length;
  const missing = Object.entries(c.notRead).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`${c.name}: ${n} boards${missing ? ` (not read: ${missing})` : ""}`);
}
console.log(`${out.length} boards in all`);
