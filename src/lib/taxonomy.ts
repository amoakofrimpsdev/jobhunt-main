// Skills and kinds of work, read from data/skills.tsv and data/occupations.tsv (jobleft's taxonomies). Everything
// here is word matching: whole words, longest alias first, so "JavaScript" is never "Java".
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Skill = { id: string; name: string; kind: string; families: Set<string> | null; related: Set<string> };
type Alias = { id: string; words: string[]; raw: string[] | null; listOnly: boolean };
type Family = { id: string; label: string; phrases: Array<{ words: string[]; atEnd: boolean }>; related: Map<string, number> };

export type Token = { norm: string; raw: string; index: number; end: number };

const MACROS: Record<string, string[]> = {
  "@tech": ["software", "data", "it", "security", "sales_eng", "business_analysis"],
  "@health": ["nursing", "health_support", "health_clinical", "health_admin"],
  "@office": ["admin", "support", "hr", "accounting", "payroll", "finance", "operations", "sales", "marketing", "project", "legal", "health_admin", "real_estate", "business_analysis"],
  "@trades": ["trades_electrical", "trades_mech", "maintenance", "construction", "construction_mgmt", "manufacturing"],
  "@edu": ["teaching", "childcare", "counseling"],
  "@mgmt": ["operations", "retail", "food", "hospitality", "logistics", "project", "construction_mgmt"],
};

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\.?[\p{L}\p{N}][\p{L}\p{N}+#'’.]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/[.'’]+$/, "");
    if (raw) out.push({ norm: raw.toLowerCase(), raw, index: m.index, end: m.index + raw.length });
  }
  return out;
}

function rows(file: string): string[][] {
  return readFileSync(join(process.cwd(), "data", file), "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("|").map((c) => c.trim()));
}

const list = (cell: string | undefined) => (cell ?? "").split(",").map((x) => x.trim()).filter(Boolean);

type Loaded = { skills: Map<string, Skill>; aliases: Map<string, Alias[]>; families: Map<string, Family>; phraseIndex: Map<string, Array<{ family: string; words: string[]; atEnd: boolean }>> };
let loaded: Loaded | null = null;

function load(): Loaded {
  if (loaded) return loaded;
  const skills = new Map<string, Skill>();
  const aliases = new Map<string, Alias[]>();
  for (const [id, name, kind, fams, aliasCell, related] of rows("skills.tsv")) {
    // A rule set (HIPAA) or a spoken language is not something a posting's skill list is scored on here.
    if (kind === "regime" || kind === "spoken") continue;
    let families: Set<string> | null = new Set<string>();
    for (const f of list(fams)) {
      if (f === "*") { families = null; break; }
      for (const x of MACROS[f] ?? [f]) families.add(x);
    }
    skills.set(id, { id, name, kind, families, related: new Set(list(related)) });
    for (let spec of list(aliasCell)) {
      const exact = spec.startsWith("=");
      if (exact) spec = spec.slice(1);
      const at = spec.lastIndexOf("@");
      // An alias with a context mark is an ordinary word too ("Go", "Rust", "Lever"): it counts only inside a list.
      const listOnly = at > 0;
      if (listOnly) spec = spec.slice(0, at).trim();
      const toks = tokenize(spec);
      if (!toks.length) continue;
      const a: Alias = { id, words: toks.map((t) => t.norm), raw: exact ? toks.map((t) => t.raw) : null, listOnly };
      const bucket = aliases.get(a.words[0]) ?? [];
      bucket.push(a);
      aliases.set(a.words[0], bucket);
    }
  }
  for (const s of skills.values()) for (const r of s.related) skills.get(r)?.related.add(s.id);
  for (const b of aliases.values()) b.sort((x, y) => y.words.length - x.words.length);

  const families = new Map<string, Family>();
  const phraseIndex: Loaded["phraseIndex"] = new Map();
  for (const [id, label, , phrases, related] of rows("occupations.tsv")) {
    const fam: Family = { id, label, phrases: [], related: new Map() };
    for (const p of list(phrases)) {
      const atEnd = p.endsWith("$");
      const words = titleWords(atEnd ? p.slice(0, -1) : p);
      if (!words.length) continue;
      fam.phrases.push({ words, atEnd });
      const bucket = phraseIndex.get(words[0]) ?? [];
      bucket.push({ family: id, words, atEnd });
      phraseIndex.set(words[0], bucket);
    }
    for (const r of list(related)) {
      const [other, w] = r.split(":");
      fam.related.set(other.trim(), Number(w));
    }
    families.set(id, fam);
  }
  for (const f of families.values()) for (const [other, w] of f.related) families.get(other)?.related.set(f.id, Math.max(w, families.get(other)?.related.get(f.id) ?? 0));
  loaded = { skills, aliases, families, phraseIndex };
  return loaded;
}

export function skillName(id: string): string {
  return load().skills.get(id)?.name ?? id;
}

export function skillsRelated(a: string, b: string): boolean {
  return load().skills.get(a)?.related.has(b) ?? false;
}

/** Every skill in the taxonomy, for the profile's skill picker. */
export function allSkills(): Array<{ id: string; name: string }> {
  return [...load().skills.values()].map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The skill a typed word names, or null. */
export function skillIdFor(term: string): string | null {
  const toks = tokenize(term).map((t) => t.norm);
  if (!toks.length) return null;
  const { aliases, skills } = load();
  for (const a of aliases.get(toks[0]) ?? []) if (a.words.length === toks.length && a.words.every((w, i) => w === toks[i])) return a.id;
  const lower = term.trim().toLowerCase();
  for (const s of skills.values()) if (s.name.toLowerCase() === lower || s.id === lower) return s.id;
  return null;
}

const LIST_MARK = /[,/()|•:;·]/;

/**
 * The skills a text names, most-mentioned first. `family` is the job's kind of work: a skill that belongs to other
 * kinds of work is not counted ("Sales" in a software posting is a department, not a skill).
 */
export function scanSkills(text: string, family: string | null = null): string[] {
  const { aliases, skills } = load();
  const toks = tokenize(text);
  const count = new Map<string, number>();
  const first = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    const bucket = aliases.get(toks[i].norm);
    if (!bucket) continue;
    for (const a of bucket) {
      if (i + a.words.length > toks.length) continue;
      let ok = true;
      for (let k = 0; k < a.words.length && ok; k++) {
        ok = toks[i + k].norm === a.words[k] && (a.raw === null || toks[i + k].raw === a.raw[k]);
      }
      if (!ok) continue;
      if (a.listOnly) {
        const before = text.slice(Math.max(0, toks[i].index - 2), toks[i].index);
        const last = toks[i + a.words.length - 1];
        const after = text.slice(last.end, last.end + 2);
        if (!LIST_MARK.test(before) && !LIST_MARK.test(after)) continue;
      }
      const s = skills.get(a.id);
      if (!s || (family && s.families && !s.families.has(family))) continue;
      count.set(a.id, (count.get(a.id) ?? 0) + 1);
      if (!first.has(a.id)) first.set(a.id, i);
      i += a.words.length - 1;
      break;
    }
  }
  return [...count.keys()].sort((x, y) => (count.get(y)! - count.get(x)!) || (first.get(x)! - first.get(y)!));
}

const SENIORITY = new Set(["senior", "sr", "junior", "jr", "staff", "principal", "lead", "i", "ii", "iii", "iv", "v", "1", "2", "3", "intern", "internship", "associate", "entry", "level", "mid", "new", "grad", "graduate", "early", "career"]);
const STOP = new Set(["of", "the", "and", "a", "an", "for", "to", "in", "at", "with", "on"]);

/** A title's words without seniority and filler ("Senior Data Analyst II" -> data, analyst). */
export function titleWords(title: string): string[] {
  return tokenize(title.replace(/[-–—/&]/g, " ")).map((t) => t.norm).filter((w) => !SENIORITY.has(w) && !STOP.has(w));
}

export type TitleFamily = { family: string; label: string; phrase: string[] };

/** The kind of work a title names: the family whose phrase covers the most words; ties go to the phrase ending last. */
export function familyOfTitle(title: string): TitleFamily | null {
  const { phraseIndex, families } = load();
  type Best = { family: string; words: string[]; end: number };
  let best = null as Best | null;
  // "Engineer, Payments (Remote)" names the job in its first part; each part is read on its own.
  for (const part of title.split(/\s+[-–—]\s+|[,|(]/)) {
    const words = titleWords(part);
    for (let i = 0; i < words.length; i++) {
      for (const p of phraseIndex.get(words[i]) ?? []) {
        if (i + p.words.length > words.length) continue;
        if (p.atEnd && i + p.words.length !== words.length) continue;
        if (!p.words.every((w, k) => words[i + k] === w)) continue;
        const end = i + p.words.length;
        if (!best || p.words.length > best.words.length || (p.words.length === best.words.length && end > best.end)) {
          best = { family: p.family, words: p.words, end };
        }
      }
    }
    if (best) break;
  }
  const hit = best as Best | null;
  return hit ? { family: hit.family, label: families.get(hit.family)!.label, phrase: hit.words } : null;
}

/** 1 = the same kind of work, 0 = unrelated. */
export function familyRelatedness(a: string, b: string): number {
  if (a === b) return 1;
  return load().families.get(a)?.related.get(b) ?? 0;
}

export function familyLabel(id: string): string {
  return load().families.get(id)?.label ?? id;
}
