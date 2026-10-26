import { rescore } from "@/lib/ingest";
import { followUkSources, getProfile, saveProfile } from "@/lib/store";
import { skillIdFor, skillName } from "@/lib/taxonomy";
import { EMPTY_PROFILE, LEVELS, type Level, type Profile, type Region } from "@/lib/types";

const names = (p: Profile) => Object.fromEntries(p.skills.map((s) => [s, skillName(s)]));

export async function GET() {
  const profile = getProfile();
  return Response.json({ profile, skillNames: names(profile) });
}

export async function PUT(request: Request) {
  const b = (await request.json()) as Partial<Profile>;
  const before = getProfile();
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
    region: (["us", "uk", "us_uk", "any"] as Region[]).includes(b.region as Region) ? (b.region as Region) : "us",
    resumeName: typeof b.resumeName === "string" ? b.resumeName.slice(0, 200) : null,
  });
  // Choosing the UK switches on the UK sources (NHS Jobs, the UK employers), which are off for a US-only feed.
  if (before.region === "us" && profile.region !== "us") followUkSources();
  // Every job is scored again in the background (a few seconds for half a million); the feed fills in its new order
  // as it goes, so saving does not wait for it.
  void rescore(true);
  return Response.json({ profile, skillNames: names(profile), scored: null, scoring: true });
}
