import { extTokenOk, noteUsed, pageContext, recordAnswers, resumeFile, saveJobFromPage } from "@/lib/ext";
import { setMeta, track } from "@/lib/store";

type Context = { params: Promise<{ action: string }> };
const denied = () => Response.json({ error: "Pair the extension first: copy the pairing code from Jobhunt's Settings." }, { status: 401 });
const paired = (request: Request) => extTokenOk(request.headers.get("x-jobhunt-ext"));

export async function GET(request: Request, { params }: Context) {
  const { action } = await params;
  const q = new URL(request.url).searchParams;
  // Anyone may ask whether Jobhunt is here; everything else needs the pairing code.
  if (action === "ping") return Response.json({ app: "jobhunt", paired: paired(request) });
  if (!paired(request)) return denied();
  if (action === "context") return Response.json(pageContext(q.get("url") ?? ""));
  if (action === "resume") {
    const file = resumeFile(q.get("id") ?? "");
    return file ? Response.json(file) : Response.json({ error: "That resume is no longer in the library." }, { status: 404 });
  }
  return Response.json({ error: "Unknown request." }, { status: 404 });
}

export async function POST(request: Request, { params }: Context) {
  const { action } = await params;
  if (!paired(request)) return denied();
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  try {
    if (action === "answers") {
      const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
      return Response.json({ saved: recordAnswers(items, text(b.site)) });
    }
    if (action === "used") { noteUsed(Array.isArray(b.keys) ? (b.keys as string[]).filter((k) => typeof k === "string") : []); return Response.json({ ok: true }); }
    if (action === "save-job") return Response.json(saveJobFromPage({ url: text(b.url), title: text(b.title), company: text(b.company), location: text(b.location), text: text(b.text) }));
    if (action === "applied") return track(text(b.jobId), "applied") ? Response.json({ ok: true }) : Response.json({ error: "That job is not in Jobhunt." }, { status: 404 });
    if (action === "demographics") { setMeta("extRecordDemographics", b.on === true); return Response.json({ ok: true }); }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return Response.json({ error: "Unknown request." }, { status: 404 });
}
