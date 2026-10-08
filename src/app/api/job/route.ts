import { resumeFits } from "@/lib/resumes";
import { jobDetail, jobScoringFacts } from "@/lib/store";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const job = jobDetail(id);
  const facts = jobScoringFacts(id);
  if (!job || !facts) return Response.json({ error: "That job is not in the database." }, { status: 404 });
  return Response.json({ ...job, resumes: resumeFits(facts, job.match?.score ?? null) });
}
