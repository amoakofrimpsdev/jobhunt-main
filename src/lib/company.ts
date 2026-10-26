// What is known about an employer from its name alone: its H-1B filing history and whether it is likely cap-exempt.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LEGAL = new Set(["inc", "incorporated", "llc", "corp", "corporation", "co", "company", "ltd", "limited", "llp", "lp", "plc", "pbc", "pc", "pllc", "gmbh", "ag", "sa", "bv", "nv", "pte", "pty"]);

/** The company match key. Must stay the same as companyKey in scripts/build-data.mjs, which builds the table. */
export function companyKey(name: string): string {
  let s = String(name ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[&+]/g, " and ").replace(/['’`]/g, "");
  s = s.replace(/(?<![\p{L}\p{N}])\p{L}(?:\.\s?\p{L})+\.?(?![\p{L}\p{N}])/gu, (m) => m.replace(/[.\s]/g, ""));
  const t = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let end = t.length, start = 0;
  while (end - start >= 2 && LEGAL.has(t[end - 1])) { end--; if (end - start >= 2 && t[end - 1] === "and") end--; }
  if (end - start >= 2 && t[start] === "the") start++;
  return t.slice(start, end).join("");
}

type H1bTable = { source: string; version: string; window: { from: string; to: string }; counts: Record<string, number> };
let table: H1bTable | null = null;

function h1b(): H1bTable {
  table ??= JSON.parse(readFileSync(join(process.cwd(), "data", "h1b-sponsors.json"), "utf8")) as H1bTable;
  return table;
}

export function h1bWindow(): { from: string; to: string } {
  return h1b().window;
}

/** Certified H-1B labor condition applications the employer filed in the table's window. 0 = none found. */
export function h1bFilings(company: string): number {
  // Only the table's own entries: a company named "Constructor" or "toString" must not find the object's built-ins.
  const counts = h1b().counts;
  const key = companyKey(company);
  const n = Object.hasOwn(counts, key) ? counts[key] : 0;
  return typeof n === "number" ? n : 0;
}

// The Home Office register of licensed sponsors (data/uk-sponsors.json): employers that may sponsor a Skilled Worker
// visa. Employers register under their legal name ("Monzo Bank Limited") and post jobs under their trading name
// ("Monzo"), so both sides are also matched without trailing words like "Bank", "Group" or "UK".
const GENERIC_TAIL = new Set(["uk", "gb", "bank", "group", "holdings", "holding", "technologies", "technology", "tech", "services", "europe", "emea", "international", "global", "digital", "solutions", "software", "labs", "trading", "ventures", "operations", "london", "payments", "retail"]);

/** The keys a name is matched by: its company key, and the same without generic trailing words. */
export function sponsorKeys(name: string): string[] {
  const full = companyKey(name);
  const words = String(name ?? "").toLowerCase().replace(/[&+]/g, " and ").replace(/['’`.]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .filter((w) => !LEGAL.has(w));
  while (words.length > 1 && GENERIC_TAIL.has(words[words.length - 1])) words.pop();
  const short = companyKey(words.join(" "));
  return [...new Set([full, short].filter((k) => k.length >= 3))];
}

type UkTable = { source: string; date: string; keys: string[] };
let uk: Set<string> | null = null;

function ukTable(): Set<string> {
  if (!uk) {
    try {
      uk = new Set((JSON.parse(readFileSync(join(process.cwd(), "data", "uk-sponsors.json"), "utf8")) as UkTable).keys);
    } catch {
      uk = new Set();
    }
  }
  return uk;
}

/** On the Home Office register of licensed sponsors for Skilled Worker visas, by name. A name is not proof. */
export function ukSponsorLikely(company: string): boolean {
  const t = ukTable();
  return sponsorKeys(company).some((k) => t.has(k));
}

// Cap-exempt employers (universities, their hospitals, nonprofit and government research labs) can file H-1B
// petitions all year, outside the lottery. A name is not proof, so the app always says "likely".
const CAP_EXEMPT = new RegExp([
  String.raw`\buniversit(?:y\b|ies\b)`,
  String.raw`\bcolleges?\b`,
  String.raw`\binstitute\s+of\s+technology\b`,
  String.raw`\bpolytechnic\b`,
  String.raw`\bschool\s+of\s+(?:medicine|public\s+health|nursing|law|engineering)\b`,
  String.raw`\bmedical\s+(?:school|college)\b`,
  String.raw`\bacademic\s+(?:medical|health)\b`,
  String.raw`\bnational\s+(?:lab|labs|laboratory|laboratories)\b`,
  String.raw`\bresearch\s+(?:institute|foundation|center|centre|corporation)\b`,
  String.raw`\b(?:cancer|biomedical|medical)\s+research\b`,
  String.raw`\bnational\s+institutes?\s+of\s+health\b`,
].join("|"), "i");
const NOT_CAP_EXEMPT = /\b(?:college\s+board|collegevine|college\s+hunks|university\s+of\s+phoenix|grand\s+canyon\s+education|devry|strayer|capella|full\s+sail)\b/i;

export function capExemptLikely(company: string): boolean {
  const name = (company ?? "").replace(/[-_]+/g, " ");
  return CAP_EXEMPT.test(name) && !NOT_CAP_EXEMPT.test(name);
}
