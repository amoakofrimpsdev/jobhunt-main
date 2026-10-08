import { NextResponse } from "next/server";
import { crawlAndIngestJobs } from "@/lib/scraper";

export async function GET() {
  try {
    const result = await crawlAndIngestJobs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
