import { directory, listBoards } from "@/lib/store";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const added = new Set(listBoards().map((b) => `${b.ats}:${b.slug}`));
  const rows = directory().filter((b) => !added.has(`${b.ats}:${b.slug}`) && (!q || b.name.toLowerCase().includes(q) || b.slug.includes(q)));
  // Names that start with the search come first, then boards jobleft has seen answer.
  rows.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || Number(b.verified) - Number(a.verified) || a.name.localeCompare(b.name));
  return Response.json({ total: rows.length, boards: rows.slice(0, 30) });
}
