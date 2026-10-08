import { rescore } from "@/lib/ingest";
import { getProfile, saveProfile } from "@/lib/store";
import { skillIdFor, skillName } from "@/lib/taxonomy";
import { EMPTY_PROFILE, LEVELS, type Level, type Profile } from "@/lib/types";

const names = (p: Profile) => Object.fromEntries(p.skills.map((s) => [s, skillName(s)]));

export async function GET() {
  const profile = getProfile();
  return Response.json({ profile, skillNames: names(profile) });
}

export async function PUT(request: Request) {
  const b = (await request.json()) as Partial<Profile>;
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, max) : []);
  const years = typeof b.years === "number" && b.years >= 0 && b.years <= 60 ? Math.round(b.years) : null;
  const profile = saveProfile({
    ...EMPTY_PROFILE,
    name: typeof b.name === "string" ? b.name.trim().slice(0, 120) : "",
    targetTitles: strings(b.targetTitles, 8),
    // Only skills the taxonomy knows can be matched against a posting.
    skills: strings(b.skills, 80).map((s) => skillIdFor(s) ?? "").filter(Boolean),
    years,
    level: LEVELS.includes(b.level as Level) ? (b.level as Level) : null,
    locations: strings(b.locations, 8),
    remoteOk: b.remoteOk !== false,
    needsSponsorship: b.needsSponsorship === true,
    usOnly: b.usOnly !== false,
    resumeName: typeof b.resumeName === "string" ? b.resumeName.slice(0, 200) : null,
  });
  const scored = rescore();
  return Response.json({ profile, skillNames: names(profile), scored });
}
