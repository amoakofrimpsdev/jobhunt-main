import { refreshStatus } from "@/lib/ingest";
import { feed, getProfile, profileReady, type FeedFilter } from "@/lib/store";

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
  const on = (k: string) => p.get(k) === "1";
  const sort = p.get("sort");
  const profile = getProfile();
  // Until the person sets these two filters themselves, they follow the profile.
  const usOnly = p.has("us") ? on("us") : profile.usOnly;
  const hideBlocked = p.has("hideBlocked") ? on("hideBlocked") : profile.needsSponsorship;
  const filter: FeedFilter = {
    q: p.get("q") ?? "",
    workModels: list("work"),
    levels: list("level"),
    postedWithinDays: Number(p.get("days")) || undefined,
    usOnly,
    hideBlocked,
    h1bOnly: on("h1b"),
    eVerifyOnly: on("everify"),
    capExemptOnly: on("capExempt"),
    payListed: on("pay"),
    minScore: Number(p.get("minScore")) || undefined,
    sort: sort === "newest" || sort === "score" ? sort : "recommended",
    limit: Math.min(400, Number(p.get("limit")) || 40),
    offset: Number(p.get("offset")) || 0,
  };
  return Response.json({
    ...feed(filter),
    applied: { usOnly, hideBlocked },
    refresh: refreshStatus(),
    profile: { ready: profileReady(profile), name: profile.name, needsSponsorship: profile.needsSponsorship },
  });
}
