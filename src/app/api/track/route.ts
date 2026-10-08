import { track, tracked } from "@/lib/store";
import { TRACK_STATUSES, type TrackStatus } from "@/lib/types";

export async function GET() {
  return Response.json({ jobs: tracked() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { jobId?: string; status?: string | null; notes?: string };
  if (!body.jobId) return Response.json({ error: "jobId is required." }, { status: 400 });
  if (body.status !== null && !TRACK_STATUSES.includes(body.status as TrackStatus)) {
    return Response.json({ error: "Unknown status." }, { status: 400 });
  }
  const found = track(body.jobId, body.status as TrackStatus | null, typeof body.notes === "string" ? body.notes.slice(0, 5000) : undefined);
  return found ? Response.json({ ok: true }) : Response.json({ error: "That job is not in the database." }, { status: 404 });
}
