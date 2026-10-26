import { REED_COLLECTION, checkCollection } from "@/lib/collections";
import { startRefresh } from "@/lib/ingest";
import { hasSecret, setSecret } from "@/lib/secrets";
import { listCollections } from "@/lib/store";

/** Whether a Reed API key is saved. The key itself never leaves the system's key store except to Reed. */
export async function GET() {
  return Response.json({ key: hasSecret("reed") });
}

/** Saves (or, given "", removes) the Reed key, checks it with one search, and starts finding employers' boards. */
export async function PUT(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key) { setSecret("reed", null); return Response.json({ key: false }); }
  if (!/^[A-Za-z0-9-]{20,60}$/.test(key)) return Response.json({ error: "That does not look like a Reed API key: copy it again from reed.co.uk/developers." }, { status: 400 });
  const res = await fetch("https://www.reed.co.uk/api/1.0/search?keywords=analyst&resultsToTake=1", {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` }, signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return Response.json({ error: "Reed did not answer. Check the connection and try again." }, { status: 502 });
  if (res.status === 401 || res.status === 403) return Response.json({ error: "Reed did not accept that key." }, { status: 400 });
  try { setSecret("reed", key); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  const c = listCollections().find((x) => x.id === REED_COLLECTION);
  if (c?.enabled) void checkCollection(c).then((added) => { if (added) startRefresh(); });
  return Response.json({ key: true });
}
