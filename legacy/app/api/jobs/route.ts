import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const matchesRes = await query("SELECT * FROM job_matches WHERE user_id = $1 ORDER BY score DESC", ["anonymous"]);
    const matches = matchesRes.rows ?? [];

    if (!matches) {
      return NextResponse.json({ success: true, jobs: [] });
    }

    // fetch job listings for these job_ids
    const ids = matches.map((m: any) => m.job_id).filter(Boolean);
    let jobs: any[] = [];
    if (ids.length > 0) {
      const placeholders = ids.map((__item: any, i: number) => `$${i + 1}`).join(',');
      const jobsRes = await query(`SELECT * FROM job_listings WHERE id IN (${placeholders})`, ids);
      jobs = jobsRes.rows ?? [];
    }

    const combined = matches
      .map((match: any) => ({
        ...match,
        job_listing: jobs.find((job: any) => job.id === match.job_id) ?? null,
      }))
      .filter((item: any) => item.job_listing !== null)
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

    return NextResponse.json({ success: true, jobs: combined });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
