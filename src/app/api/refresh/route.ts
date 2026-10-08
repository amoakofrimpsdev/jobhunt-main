import { refreshStatus, startRefresh } from "@/lib/ingest";

export async function GET() {
  return Response.json(refreshStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { boardIds?: number[] };
  return Response.json(startRefresh(Array.isArray(body.boardIds) ? body.boardIds : undefined));
}
