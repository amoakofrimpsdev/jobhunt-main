import { NextResponse, type NextRequest } from "next/server";

const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const refuse = () => new NextResponse("Jobhunt answers only to its own pages on this computer.", { status: 403 });

/**
 * The local API has no sign-in, so it answers only to this app's own pages: the request must be addressed to a
 * loopback name, and a change (anything but GET) must come from a page of the same origin. Another website open in
 * the browser can therefore not add boards or edit the tracker.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL.test(host)) return refuse();
  const origin = request.headers.get("origin");
  // The browser extension calls from its own origin; its routes check the pairing code instead.
  if (origin?.startsWith("chrome-extension://") && request.nextUrl.pathname.startsWith("/api/ext/")) return NextResponse.next();
  if (origin && request.method !== "GET" && request.method !== "HEAD") {
    try {
      if (new URL(origin).host !== host) return refuse();
    } catch {
      return refuse();
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
