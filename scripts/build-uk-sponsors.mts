// Rebuilds data/uk-sponsors.json from the Home Office "Register of licensed sponsors: workers" on GOV.UK (published
// under the Open Government Licence, updated every working day). Only sponsors licensed for the Skilled Worker or
// Global Business Mobility routes are kept: the routes a graduate job can be sponsored under.
//   npm run data:uk-sponsors
import { writeFileSync } from "node:fs";
import { sponsorKeys } from "../src/lib/company";

const PAGE = "https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers";
const UA = { "User-Agent": "jobhunt (builds a local copy of the UK sponsor register)" };

/** One CSV line into its fields ("a","b, c",d). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const page = (await (await fetch(PAGE, { headers: UA })).json()) as { details: { attachments?: Array<{ url: string; content_type: string }>; documents?: string[] } };
const csvUrl = page.details.attachments?.find((a) => a.content_type === "text/csv")?.url
  ?? /href="([^"]+\.csv)"/.exec((page.details.documents ?? []).join(""))?.[1];
if (!csvUrl) throw new Error("The GOV.UK page links no CSV register.");
const csv = await (await fetch(csvUrl, { headers: UA })).text();
const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
const head = fields(lines[0]).map((h) => h.trim());
const name = head.indexOf("Organisation Name"), route = head.indexOf("Route");
if (name < 0 || route < 0) throw new Error(`Unexpected columns: ${head.join(", ")}`);
const keys = new Set<string>();
let kept = 0;
for (const line of lines.slice(1)) {
  const f = fields(line);
  if (!/skilled worker|global business mobility/i.test(f[route] ?? "")) continue;
  kept++;
  for (const k of sponsorKeys(f[name] ?? "")) keys.add(k);
}
const date = /(\d{4}-\d{2}-\d{2})\.csv$/.exec(csvUrl)?.[1] ?? new Date().toISOString().slice(0, 10);
writeFileSync("data/uk-sponsors.json", JSON.stringify({ source: `Home Office register of licensed sponsors: workers (${csvUrl})`, date, keys: [...keys].sort() }));
console.log(`${kept} sponsor licences, ${keys.size} names, register of ${date}`);
