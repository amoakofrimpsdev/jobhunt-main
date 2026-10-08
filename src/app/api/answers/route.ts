import { listAnswers, removeAnswer, saveAnswer, seedAnswers, STANDARD_ANSWERS } from "@/lib/answers";
import { extToken, newExtToken } from "@/lib/ext";

function state() {
  seedAnswers();
  return Response.json({ answers: listAnswers(), standard: STANDARD_ANSWERS, pairingCode: extToken() });
}

export async function GET() {
  return state();
}

/** Saves one answer ({ key, label, value }; an empty value removes it), or makes a new pairing code ({ newCode: true }). */
export async function PUT(request: Request) {
  const b = (await request.json()) as { key?: string; label?: string; value?: string; newCode?: boolean };
  if (b.newCode) newExtToken();
  else if (typeof b.key === "string" && typeof b.value === "string") saveAnswer({ key: b.key, label: b.label ?? b.key, value: b.value });
  return state();
}

export async function DELETE(request: Request) {
  removeAnswer(new URL(request.url).searchParams.get("key") ?? "");
  return state();
}
