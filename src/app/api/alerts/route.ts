import { createAlert, listAlerts, listHits, markHitsSeen, removeAlert, setAlertEnabled, unseenHits } from "@/lib/alerts";

const state = () => Response.json({ alerts: listAlerts(), hits: listHits(), unseen: unseenHits() });

/** ?count=1 answers only how many unread hits there are (the badge in the navigation). */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has("count")) return Response.json({ unseen: unseenHits() });
  return state();
}

/** { name, params } saves the feed's current filters as an alert. { id, enabled } switches one. { seen: true } marks all hits read. */
export async function POST(request: Request) {
  const b = (await request.json()) as { name?: string; params?: string; id?: number; enabled?: boolean; seen?: boolean };
  if (b.seen) markHitsSeen();
  else if (typeof b.id === "number" && typeof b.enabled === "boolean") setAlertEnabled(b.id, b.enabled);
  else if (typeof b.name === "string" && typeof b.params === "string") createAlert(b.name, b.params);
  else return Response.json({ error: "Nothing to do." }, { status: 400 });
  return state();
}

export async function DELETE(request: Request) {
  removeAlert(Number(new URL(request.url).searchParams.get("id")));
  return state();
}
