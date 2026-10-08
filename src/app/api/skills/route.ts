import { allSkills } from "@/lib/taxonomy";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return Response.json({ skills: [] });
  const hits = allSkills().filter((s) => s.name.toLowerCase().includes(q));
  hits.sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length);
  return Response.json({ skills: hits.slice(0, 8) });
}
