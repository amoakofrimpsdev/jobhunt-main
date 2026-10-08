import { NextResponse } from "next/server";
import { computeMatchesForLatestResume } from "@/lib/matching";

export async function GET() {
  try {
    const result = await computeMatchesForLatestResume("anonymous");
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
