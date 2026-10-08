// Reading a resume into a profile proposal with plain text rules: no model, nothing sent anywhere. The person
// reviews and edits the proposal before it is saved.
import { inflateRawSync } from "node:zlib";
import { PDFParse } from "pdf-parse";
import { levelOfYears } from "./parse/facts";
import { familyOfTitle, scanSkills } from "./taxonomy";
import { decodeEntities } from "./text";
import type { Profile } from "./types";

/**
 * The text of a Word file. A .docx is a zip; the words are in word/document.xml. The zip's own index (at the end of
 * the file) says where that part is, so no unzip library is needed.
 */
function docxText(file: Buffer): string {
  const end = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("this is not a Word (.docx) file");
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  for (let i = 0; i < count && file.readUInt32LE(at) === 0x02014b50; i++) {
    const method = file.readUInt16LE(at + 10);
    const size = file.readUInt32LE(at + 20);
    const nameLength = file.readUInt16LE(at + 28);
    const skip = file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
    const local = file.readUInt32LE(at + 42);
    const name = file.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === "word/document.xml") {
      const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
      const raw = file.subarray(start, start + size);
      const xml = (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
      return decodeEntities(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")).trim();
    }
    at += 46 + nameLength + skip;
  }
  throw new Error("the Word file has no document text");
}

export const RESUME_FILE = /\.(pdf|docx|txt|md)$/i;

export async function resumeText(file: Buffer, filename: string): Promise<string> {
  if (/\.docx$/i.test(filename)) return docxText(file);
  if (/\.pdf$/i.test(filename)) {
    const parser = new PDFParse({ data: new Uint8Array(file) });
    try {
      return (await parser.getText()).text.trim();
    } finally {
      await parser.destroy();
    }
  }
  return file.toString("utf8").trim();
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = String.raw`(?:(${MONTHS})\.?\s+|(\d{1,2})\/)?((?:19|20)\d{2})`;
const RANGE = new RegExp(String.raw`${DATE}\s*(?:-|–|—|to)\s*(?:${DATE}|(present|current|now|today))`, "gi");
const HEADING = /^\s*(?:work\s+|professional\s+|relevant\s+|research\s+)?(experience|employment(?:\s+history)?|education|skills|technical\s+skills|projects|certifications?|publications|awards|honors|leadership|activities|summary|volunteer(?:ing)?)\s*:?\s*$/i;

function monthIndex(name: string | undefined, digits: string | undefined, year: string, fallback: number): number {
  const m = name ? "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(name.slice(0, 3).toLowerCase()) / 3 : digits ? Number(digits) - 1 : fallback;
  return Number(year) * 12 + Math.max(0, Math.min(11, m));
}

/** Months of work: the union of the date ranges under an experience heading (school years are not work). */
function workYears(text: string): number | null {
  const lines = text.split("\n");
  let section = "";
  let sawExperience = false;
  const spans: Array<[number, number]> = [];
  const now = new Date();
  const thisMonth = now.getFullYear() * 12 + now.getMonth();
  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) { section = h[1].toLowerCase(); if (/experience|employment/.test(section)) sawExperience = true; continue; }
    if (/education|projects|publications|awards|honors|activities|certification/.test(section)) continue;
    for (const m of line.matchAll(RANGE)) {
      const start = monthIndex(m[1], m[2], m[3], 0);
      const end = m[7] ? thisMonth : monthIndex(m[4], m[5], m[6], 11);
      if (end >= start && end - start < 600 && start <= thisMonth) spans.push([start, Math.min(end, thisMonth)]);
    }
  }
  if (!spans.length || !sawExperience && spans.length < 2) return spans.length ? Math.round(spans.reduce((n, [a, b]) => Math.max(n, b - a + 1), 0) / 12) : null;
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0, until = -1;
  for (const [a, b] of spans) {
    months += Math.max(0, b - Math.max(a, until + 1) + 1);
    until = Math.max(until, b);
  }
  return Math.round(months / 12);
}

function titlesIn(text: string): string[] {
  const out = new Map<string, string>();
  let section = "";
  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) { section = heading[1].toLowerCase(); continue; }
    // A skills list names kinds of work ("Product management") that are not jobs the person held.
    if (line.length > 90 || /skills|education|certification/.test(section)) continue;
    for (const piece of line.split(/\s+[|–—-]\s+|,|\s+at\s+|\t|\s{3,}|\(/)) {
      // "Analyst Intern" was an internship; the job to look for is "Analyst".
      const title = piece.replace(/\b(?:19|20)\d{2}\b.*$/, "").replace(/[•·*]/g, "").replace(/\s+(?:intern|internship|co-?op)$/i, "").trim();
      const words = title.split(/\s+/);
      if (words.length < 1 || words.length > 6 || !/^[A-Z]/.test(title)) continue;
      const fam = familyOfTitle(title);
      // The phrase must be most of the piece: "Python developer tools" is not a title.
      if (fam && fam.phrase.length >= Math.ceil(words.length / 2)) out.set(title.toLowerCase(), title);
    }
  }
  return [...out.values()];
}

function nameIn(text: string): string {
  for (const line of text.split("\n").slice(0, 6)) {
    const t = line.trim();
    if (/^[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]*){1,3}$/u.test(t) && !HEADING.test(t)) return t;
  }
  return "";
}

/** What the resume says, as profile fields the person can accept or change. */
export function proposeProfile(text: string): Pick<Profile, "name" | "targetTitles" | "skills" | "years" | "level"> {
  const years = workYears(text);
  return {
    name: nameIn(text),
    targetTitles: titlesIn(text).slice(0, 4),
    skills: scanSkills(text).slice(0, 40),
    years,
    level: years === null ? null : levelOfYears(years),
  };
}
