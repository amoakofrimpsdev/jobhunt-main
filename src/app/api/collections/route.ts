import { rescore } from "@/lib/ingest";
import { listCollections, setCollectionEnabled } from "@/lib/store";

export async function GET() {
  return Response.json({ collections: listCollections() });
}

/** Switches a collection on or off. Its boards and jobs are kept either way. */
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; enabled?: boolean };
  if (!body.id || typeof body.enabled !== "boolean") return Response.json({ error: "id and enabled are required." }, { status: 400 });
  setCollectionEnabled(body.id, body.enabled);
  rescore();
  return Response.json({ collections: listCollections() });
}
