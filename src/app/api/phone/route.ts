import QRCode from "qrcode";
import { forgetPhones, phoneStatus, setPhoneAccess, type PhoneStatus } from "@/lib/phone";

const withCode = async (s: PhoneStatus) => ({
  ...s,
  qr: s.pairUrl ? await QRCode.toString(s.pairUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0a0a0a", light: "#ffffff" } }) : null,
});

/** Phone access: whether it is on, the pairing QR code, and the paired phones. Answered on this computer only. */
export async function GET() {
  return Response.json(await withCode(phoneStatus()));
}

/** { enabled: boolean } switches phone access on or off. */
export async function PUT(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  // The app's own port, as this request reached it.
  const appPort = Number(new URL(request.url).port) || Number(request.headers.get("host")?.split(":")[1]) || Number(process.env.PORT) || 3000;
  return Response.json(await withCode(await setPhoneAccess(b.enabled === true, appPort)));
}

/** { forget: id } forgets one phone; { forget: "all" } forgets every phone and makes a new pairing code. */
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { forget?: unknown };
  const id = typeof b.forget === "string" && b.forget !== "all" ? b.forget : undefined;
  return Response.json(await withCode(forgetPhones(id)));
}
