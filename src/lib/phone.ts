// Jobhunt on a phone on the same Wi-Fi. The app itself only ever answers on this computer's loopback address. When
// phone access is switched on in Settings, a second, small server listens on the local network and passes a paired
// phone's requests to the app. A phone pairs by scanning a QR code shown in Settings: the code carries a secret, and
// the phone keeps a session cookie from then on. Requests from anything but a paired phone on a private network are
// turned away, and the computer-only parts (Settings, API keys, the extension's pairing code, recorded answers) are
// never passed on.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { getMeta, setMeta } from "./store";

const PHONE_PORTS = [47610, 47611, 47612, 47613];
const COOKIE = "jh_phone";
const YEAR = 365 * 86_400;

type Paired = { hash: string; name: string; pairedAt: string; lastSeenAt: string };
type Access = { enabled: boolean; appPort: number };
type Running = { server: http.Server; port: number; appPort: number };

export type PhoneStatus = {
  enabled: boolean;
  running: boolean;
  /** The port the phone door listens on, when it is open. */
  port: number | null;
  /** The address the phone opens, with the pairing secret: shown as a QR code on this computer only. */
  pairUrl: string | null;
  /** The same pairing secret, short enough to type on a phone that opened the address by hand. */
  pairCode: string | null;
  /** The address without the secret, for a phone that is already paired. */
  url: string | null;
  addresses: string[];
  phones: Array<{ id: string; name: string; pairedAt: string; lastSeenAt: string }>;
  error: string | null;
};

const g = globalThis as unknown as { __jobhuntPhone?: Running | null; __jobhuntPhoneError?: string | null };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function pairToken(): string {
  let t = getMeta<string | null>("phonePairToken", null);
  if (!t) { t = randomBytes(24).toString("base64url"); setMeta("phonePairToken", t); }
  return t;
}

/** Six letters and digits that cannot be confused with each other (no 0/O, 1/I/L). */
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function pairCode(): string {
  let c = getMeta<string | null>("phonePairCode", null);
  if (!c) { c = [...randomBytes(6)].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join(""); setMeta("phonePairCode", c); }
  return c;
}
/** Wrong codes typed in the last ten minutes: after ten, typing is refused until the time has passed. */
const failures: number[] = [];

const sessions = () => getMeta<Paired[]>("phoneSessions", []);

/** One line per pairing, refusal or first request of a phone, in the app's log (logs/server.log). */
function log(req: http.IncomingMessage, what: string): void {
  const ua = String(req.headers["user-agent"] ?? "");
  const device = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : ua.slice(0, 40) || "unknown";
  const path = (req.url ?? "/").replace(/([?&]t=)[^&]+/, "$1…");
  console.log(`[phone] ${new Date().toISOString()} ${req.socket.remoteAddress ?? "?"} ${device} ${req.method} ${path}: ${what}`);
}

function deviceName(req: http.IncomingMessage): string {
  const ua = String(req.headers["user-agent"] ?? "");
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : "Phone";
}

function pairNow(req: http.IncomingMessage, res: http.ServerResponse): void {
  const session = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  setMeta("phoneSessions", [...sessions(), { hash: sha(session), name: deviceName(req), pairedAt: now, lastSeenAt: now }].slice(-10));
  log(req, "paired");
  res.writeHead(302, { location: "/", "set-cookie": `${COOKIE}=${session}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax`, "cache-control": "no-store" });
  res.end();
}

/** The page an unpaired phone sees: scan the code, or type it here. */
function pairPage(res: http.ServerResponse, status: number, note = ""): void {
  page(res, status, "Pair this phone", `${note ? `<b>${note}</b><br><br>` : ""}On your computer, open Jobhunt, go to Settings and switch on <b>Phone</b>. Scan the code with this phone's camera, or type the six-letter code shown under it here:</p>
<form method="post" action="/phone/pair" style="display:flex;gap:8px;margin-top:12px"><input name="code" required maxlength="8" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="ABC123"
 style="flex:1;font:inherit;font-size:22px;letter-spacing:.15em;text-transform:uppercase;padding:10px 12px;border:1px solid #c9c3b3;border-radius:8px;background:#fff;color:#0a0a0a;min-width:0">
<button style="font:inherit;font-weight:600;padding:10px 16px;border:0;border-radius:8px;background:#0a0a0a;color:#fff">Pair</button></form><p>`);
}

/** This computer's addresses on private networks (home and office Wi-Fi), Wi-Fi first. */
export function lanAddresses(): string[] {
  const out: Array<{ ip: string; rank: number }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || !isPrivate(a.address)) continue;
      const rank = /^(?:en0|wlan|wi-?fi|wireless)/i.test(name) ? 0 : /^(?:en|eth|ethernet)/i.test(name) ? 1 : 2;
      out.push({ ip: a.address, rank });
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.ip);
}

function isPrivate(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  // 100.64.0.0/10 is shared address space: some campus, hotel and carrier networks hand it out, and so does
  // Tailscale. It is not reachable from the internet either.
  return /^10\./.test(v4) || /^192\.168\./.test(v4) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(v4) || /^169\.254\./.test(v4) || v4 === "127.0.0.1" || ip === "::1"
    || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4)
    || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}

function page(res: http.ServerResponse, status: number, title: string, text: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Jobhunt</title>
<style>body{margin:0;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#fffaf0;color:#0a0a0a;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:420px}h1{font-size:28px;margin:0 0 8px}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`);
}

/** Paths a phone may not use: they belong to the computer (keys, the extension, the connector, this setting). */
function computerOnly(method: string, path: string): boolean {
  if (/^\/(?:settings)(?:\/|$)/.test(path)) return true;
  if (/^\/api\/(?:answers|ext|mcp|phone|reed|claude)(?:\/|$|\?)/.test(path)) return true;
  if (/^\/api\/ai(?:\/|$|\?)/.test(path) && method === "PUT") return true;
  return false;
}

function cookieOf(req: http.IncomingMessage): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(req.headers.cookie ?? "");
  return m ? m[1] : null;
}

let lastSeenWrite = 0;

function handle(run: Running, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!isPrivate(req.socket.remoteAddress ?? "")) { log(req, "refused: not a private network"); return page(res, 403, "Not here", "Jobhunt only answers phones on the same private network."); }
  const url = new URL(req.url ?? "/", "http://phone");
  const method = req.method ?? "GET";

  // Pairing by the typed code: a form on the unpaired page posts it here.
  if (url.pathname === "/phone/pair" && method === "POST") {
    let body = "";
    req.on("data", (c: Buffer) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => {
      while (failures.length && Date.now() - failures[0] > 10 * 60_000) failures.shift();
      if (failures.length >= 10) { log(req, "refused: too many wrong codes"); return pairPage(res, 429, "Too many wrong codes. Wait ten minutes, then try again."); }
      const given = (new URLSearchParams(body).get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const want = pairCode();
      if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
        failures.push(Date.now());
        log(req, "wrong code typed");
        return pairPage(res, 403, "That code is not the one shown in Settings.");
      }
      pairNow(req, res);
    });
    return;
  }

  if (url.pathname === "/phone/pair") {
    const given = url.searchParams.get("t") ?? "";
    const want = pairToken();
    if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
      log(req, "refused: old QR code");
      return pairPage(res, 403, "That QR code is an old one.");
    }
    return pairNow(req, res);
  }

  const session = cookieOf(req);
  const known = session ? sessions().find((s) => s.hash === sha(session)) : undefined;
  if (!known) {
    log(req, session ? "unpaired: this phone's pairing was forgotten" : "unpaired: no pairing cookie");
    return pairPage(res, 401, session ? "This phone was unpaired." : "");
  }
  if (computerOnly(method, url.pathname)) return page(res, 403, "On your computer only", "Settings, API keys and the browser extension can only be changed in Jobhunt on your computer.");
  // A change must come from Jobhunt's own pages on the phone: another site open on the phone cannot make one.
  const origin = req.headers.origin;
  if (origin && method !== "GET" && method !== "HEAD") {
    try { if (new URL(origin).host !== req.headers.host) return page(res, 403, "Not allowed", "That request did not come from Jobhunt."); } catch { return page(res, 403, "Not allowed", "That request did not come from Jobhunt."); }
  }
  if (Date.now() - lastSeenWrite > 60_000) {
    lastSeenWrite = Date.now();
    log(req, `in use (${known.name})`);
    setMeta("phoneSessions", sessions().map((s) => (s.hash === known.hash ? { ...s, lastSeenAt: new Date().toISOString() } : s)));
  }

  // On to the app, as if asked on this computer: its own guard accepts only loopback addresses and same-origin changes.
  // Named "localhost", the name the development server also trusts for its own live-reload connection.
  const local = `localhost:${run.appPort}`;
  const headers = { ...req.headers, host: local, "x-jobhunt-phone": "1" } as http.OutgoingHttpHeaders;
  delete headers.cookie;
  delete headers.referer;
  if (origin) headers.origin = `http://${local}`;
  const up = http.request({ host: "127.0.0.1", port: run.appPort, method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) page(res, 502, "Jobhunt is not answering", "Jobhunt on your computer did not answer. Is it still open?"); else res.end(); });
  req.pipe(up);
}

function listen(appPort: number, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const run: Running = { server: null as unknown as http.Server, port, appPort };
    const server = http.createServer((req, res) => handle(run, req, res));
    // WebSockets (the development server's live reload): passed on for a paired phone only, as raw bytes.
    server.on("upgrade", (req, socket, head) => {
      const session = cookieOf(req);
      if (!isPrivate(req.socket.remoteAddress ?? "") || !session || !sessions().some((x) => x.hash === sha(session))) return void socket.destroy();
      const up = net.connect(appPort, "127.0.0.1", () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i], lower = k.toLowerCase();
          if (lower === "cookie" || lower === "referer") continue;
          lines.push(`${k}: ${lower === "host" ? `localhost:${appPort}` : lower === "origin" ? `http://localhost:${appPort}` : req.rawHeaders[i + 1]}`);
        }
        up.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
      up.on("error", () => socket.destroy());
      socket.on("error", () => up.destroy());
    });
    run.server = server;
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

async function start(appPort: number): Promise<void> {
  if (g.__jobhuntPhone) return;
  g.__jobhuntPhoneError = null;
  for (const port of PHONE_PORTS) {
    try {
      const server = await listen(appPort, port);
      g.__jobhuntPhone = { server, port, appPort };
      return;
    } catch {
      // In use: the next port.
    }
  }
  g.__jobhuntPhoneError = "Ports 47610 to 47613 are all in use, so the phone cannot reach Jobhunt.";
}

function stop(): void {
  g.__jobhuntPhone?.server.close();
  g.__jobhuntPhone = null;
}

export function phoneStatus(): PhoneStatus {
  const access = getMeta<Access>("phoneAccess", { enabled: false, appPort: 0 });
  const run = g.__jobhuntPhone;
  const addresses = lanAddresses();
  const base = run && addresses[0] ? `http://${addresses[0]}:${run.port}` : null;
  return {
    enabled: access.enabled,
    running: !!run,
    port: run?.port ?? null,
    url: base,
    pairUrl: base ? `${base}/phone/pair?t=${pairToken()}` : null,
    pairCode: base ? pairCode() : null,
    addresses,
    phones: sessions().map((s) => ({ id: s.hash.slice(0, 12), name: s.name, pairedAt: s.pairedAt, lastSeenAt: s.lastSeenAt })),
    error: g.__jobhuntPhoneError ?? (access.enabled && !addresses.length ? "This computer is not on a Wi-Fi or local network." : null),
  };
}

/** Switches phone access on or off. `appPort` is the port the app itself answers on. */
export async function setPhoneAccess(enabled: boolean, appPort: number): Promise<PhoneStatus> {
  setMeta("phoneAccess", { enabled, appPort } satisfies Access);
  if (enabled) await start(appPort); else stop();
  return phoneStatus();
}

/** Forgets one paired phone, or (with no id) every phone and the pairing code itself. */
export function forgetPhones(id?: string): PhoneStatus {
  if (id) setMeta("phoneSessions", sessions().filter((s) => !s.hash.startsWith(id)));
  else { setMeta("phoneSessions", []); setMeta("phonePairToken", null); setMeta("phonePairCode", null); }
  return phoneStatus();
}

/** At start: phone access that was on stays on. */
export async function restorePhone(): Promise<void> {
  const access = getMeta<Access>("phoneAccess", { enabled: false, appPort: 0 });
  const port = Number(process.env.PORT) || access.appPort;
  if (access.enabled && port) await start(port);
}

/** For tests: the checks that decide what reaches the app. */
export const forTests = { isPrivate, computerOnly };
