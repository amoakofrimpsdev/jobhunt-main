import { readPosting } from "@/lib/ingest";
import { resumeFits } from "@/lib/resumes";
import { jobDetail, jobScoringFacts } from "@/lib/store";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  let job = jobDetail(id);
  // A posting saved from its board's list alone is read now, so the page shows what the posting says. A board that
  // is slow to answer does not hold the page up: the text then arrives on a later run.
  if (job && !job.descriptionHtml && !job.closedAt) {
    const arrived = await Promise.race([readPosting(id), new Promise<boolean>((r) => setTimeout(() => r(false), 12_000))]);
    if (arrived) job = jobDetail(id);
  }
  const facts = jobScoringFacts(id);
  if (!job || !facts) return Response.json({ error: "That job is not in the database." }, { status: 404 });
  return Response.json({ ...job, resumes: resumeFits(facts, job.match?.score ?? null) });
}
