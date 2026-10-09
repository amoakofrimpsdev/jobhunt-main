import { refreshStatus } from "@/lib/ingest";
import { feed, filterFromParams, getProfile, profileReady } from "@/lib/store";

export async function GET(request: Request) {
  const profile = getProfile();
  const filter = filterFromParams(new URL(request.url).searchParams, profile);
  return Response.json({
    ...feed(filter),
    applied: { usOnly: filter.usOnly, hideBlocked: filter.hideBlocked },
    refresh: refreshStatus(),
    profile: { ready: profileReady(profile), name: profile.name, needsSponsorship: profile.needsSponsorship },
  });
}
