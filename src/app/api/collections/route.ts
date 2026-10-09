import { checkCollection, followCollection, isChecking } from "@/lib/collections";
import { rescore, startRefresh } from "@/lib/ingest";
import { listCollections, removeCollection, setCollectionEnabled } from "@/lib/store";

const state = () => Response.json({ collections: listCollections().map((c) => ({ ...c, checking: isChecking(c.id) })) });

export async function GET() {
  return state();
}

/**
 * { id, enabled } switches a collection on or off. { id, check: true } reads its site for new employers now.
 * { url } follows a new collection and reads it.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; enabled?: boolean; check?: boolean; url?: string };
  try {
    if (body.url) {
      const c = followCollection(body.url);
      // The first read finds its boards; a refresh then reads their jobs.
      void checkCollection(c).then((added) => { if (added) startRefresh(); });
      return state();
    }
    const c = listCollections().find((x) => x.id === body.id);
    if (!c) return Response.json({ error: "That collection is not followed." }, { status: 404 });
    if (body.check) {
      if (c.fixed || !c.url) return Response.json({ error: "This collection is a fixed list with no site to read." }, { status: 400 });
      void checkCollection(c).then((added) => { if (added) startRefresh(); });
      return state();
    }
    if (typeof body.enabled !== "boolean") return Response.json({ error: "Nothing to change." }, { status: 400 });
    setCollectionEnabled(c.id, body.enabled);
    rescore();
    return state();
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  removeCollection(new URL(request.url).searchParams.get("id") ?? "");
  rescore();
  return state();
}
