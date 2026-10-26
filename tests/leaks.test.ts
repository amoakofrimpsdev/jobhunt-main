// Data leaks. Personal details, saved answers and API keys are filled with marker strings; then every way the app
// reaches the network is run, and no marker may show up in anything that leaves the computer. Then the guards: the
// local API answers only this computer, keys never reach a page, the connector and the extension need their codes,
// the phone door lets in only paired phones and passes nothing personal through, the private files are private,
// and posting HTML cannot run code.
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fakeNetwork, isolate, refreshDone, type Call } from "./helpers";

const dir = isolate("leaks");

// Personal details, each with a marker that must never leave the computer.
const NAME = "Adaqzx Lovelacezq";
const SKILL_NOTE = "zqxresume";
const EMAIL = "adaqzx@example.invalid";
const PHONE = "+1 555 0199 4242";
const KEY = { anthropic: "sk-ant-zqxsecretzqx", openai: "sk-zqxopenaizqx", reed: "11111111-2222-3333-4444-zqxreedkeyzq" };
const TITLE = "Zqxtitle Engineer";
const PERSONAL = [NAME, SKILL_NOTE, EMAIL, PHONE, ...Object.values(KEY)];

let store: typeof import("../src/lib/store");
let ingest: typeof import("../src/lib/ingest");

before(async () => {
  store = await import("../src/lib/store");
  ingest = await import("../src/lib/ingest");
  for (const c of store.listCollections()) store.setCollectionEnabled(c.id, false);
  store.db().prepare("UPDATE boards SET enabled = 0").run();
  store.saveProfile({ ...store.getProfile(), name: NAME, targetTitles: [TITLE, "Data Engineer"], skills: ["python", "sql"], years: 2, resumeName: `${SKILL_NOTE}.pdf`, region: "any" });
  const { recordAnswers } = await import("../src/lib/ext");
  recordAnswers([{ key: "email", label: "Email", value: EMAIL }, { key: "phone", label: "Phone", value: PHONE }], "boards.greenhouse.io");
  const secrets = await import("../src/lib/secrets");
  for (const [name, value] of Object.entries(KEY)) secrets.setSecret(name, value);
});

const everywhere = (c: Call) => `${c.url}\n${JSON.stringify(c.headers)}\n${c.body}`;

test("nothing personal leaves the computer when jobs are read", async () => {
  const gh = { jobs: [{ id: 1, title: "Data Engineer", absolute_url: "https://boards.greenhouse.io/leakco/jobs/1", location: { name: "Austin, TX" }, content: "<p>SQL</p>", departments: [], offices: [], first_published: "2026-10-01T00:00:00Z" }] };
  const net = fakeNetwork([
    [/boards-api\.greenhouse\.io\/v1\/boards\/leakco\/jobs/, () => gh],
    [/leakwd\.wd1\.myworkdayjobs\.com\/wday\/cxs\/leakwd\/careers\/jobs$/, () => ({ total: 1, jobPostings: [{ title: "Analyst", externalPath: "/job/X/Analyst_R1", locationsText: "Austin, TX", postedOn: "Posted Today" }] })],
    [/leakwd\.wd1\.myworkdayjobs\.com\/wday\/cxs\/leakwd\/careers\/job\//, () => ({ jobPostingInfo: { title: "Analyst", jobDescription: "<p>Excel</p>" } })],
    [/api\.campusmesh\.com/, () => ({ data: { jobs: [], hasNext: false } })],
    [/www\.reed\.co\.uk\/api\/1\.0\/search/, () => ({ results: [{ jobId: 9, employerId: 5, employerName: "Reedco" }] })],
    [/www\.reed\.co\.uk\/api\/1\.0\/jobs\/9/, () => ({ externalUrl: "https://boards.greenhouse.io/reedco/jobs/1" })],
  ]);
  const logs: string[] = [];
  const log = console.log, error = console.error;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    const ids = [store.addBoard("greenhouse", "leakco", "Leakco"), store.addBoard("workday", "leakwd.wd1.careers", "Leakwd")];
    ingest.startRefresh(ids);
    await refreshDone(ingest.refreshStatus);
    const { checkCollection } = await import("../src/lib/collections");
    store.addCollection("campusmesh.com", "CampusMesh", "https://campusmesh.com/jobs");
    await checkCollection({ id: "campusmesh.com", name: "CampusMesh", url: "https://campusmesh.com/jobs" });
    store.addCollection("reed-employers", "Reed", "https://www.reed.co.uk/");
    await checkCollection({ id: "reed-employers", name: "Reed", url: "https://www.reed.co.uk/" });
    await (await import("../src/lib/alerts")).runAlerts();
  } finally {
    console.log = log;
    console.error = error;
    net.restore();
  }
  assert.ok(net.calls.length >= 5, `the readers were run (${net.calls.length} requests)`);
  for (const c of net.calls) {
    for (const p of PERSONAL) assert.ok(!everywhere(c).includes(p), `${p} was sent to ${c.url}`);
    assert.ok(!("cookie" in c.headers), `a cookie was sent to ${c.url}`);
    assert.match(c.headers["user-agent"] ?? "", /^jobhunt\//, `${c.url} was asked without Jobhunt's plain User-Agent`);
    const host = new URL(c.url).host;
    // Reed is the one place that gets a key (Reed's own, in its own header) and the titles searched for.
    if (host === "www.reed.co.uk") {
      assert.equal(c.headers.authorization, `Basic ${Buffer.from(`${KEY.reed}:`).toString("base64")}`);
    } else {
      assert.ok(!("authorization" in c.headers), `${c.url} was sent an Authorization header`);
      assert.ok(!everywhere(c).includes(TITLE), `the target title went to ${c.url}`);
    }
  }
  for (const line of logs) for (const p of PERSONAL) assert.ok(!line.includes(p), `the log holds ${p}: ${line}`);
});

test("only the job titles searched for, and Reed's own key, go to Reed", async () => {
  // Reed's key is in the header as Reed asks for it; the address carries the title and nothing else of the profile.
  const net = fakeNetwork([[/www\.reed\.co\.uk/, () => ({ results: [] })]]);
  try {
    const { checkCollection } = await import("../src/lib/collections");
    await checkCollection({ id: "reed-employers", name: "Reed", url: "https://www.reed.co.uk/" });
  } finally {
    net.restore();
  }
  const searches = net.calls.filter((c) => c.url.includes("/search"));
  assert.ok(searches.some((c) => decodeURIComponent(c.url).includes(TITLE)));
  for (const c of searches) for (const p of PERSONAL.filter((x) => x !== KEY.reed)) assert.ok(!everywhere(c).includes(p), `${p} went to Reed`);
  for (const c of searches) assert.ok(!c.url.includes(KEY.reed), "the key is never in the address");
});

test("no API answer carries a saved key", async () => {
  const answers = [
    await (await import("../src/app/api/ai/route")).GET(),
    await (await import("../src/app/api/reed/route")).GET(),
    await (await import("../src/app/api/profile/route")).GET(),
    await (await import("../src/app/api/answers/route")).GET(),
    await (await import("../src/app/api/jobs/route")).GET(new Request("http://127.0.0.1/api/jobs?limit=5")),
  ];
  for (const r of answers) {
    const text = await r.text();
    for (const k of Object.values(KEY)) assert.ok(!text.includes(k), `a key is in ${text.slice(0, 80)}`);
  }
});

test("the local API answers only this computer's own pages", async () => {
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../src/proxy");
  const ask = (url: string, init: { method?: string; host?: string; origin?: string } = {}) =>
    proxy(new NextRequest(url, { method: init.method ?? "GET", headers: { host: init.host ?? new URL(url).host, ...(init.origin ? { origin: init.origin } : {}) } })).status;
  assert.equal(ask("http://127.0.0.1:47600/api/jobs"), 200);
  assert.equal(ask("http://127.0.0.1:47600/api/jobs", { host: "evil.example" }), 403, "a page reached through another name (DNS rebinding)");
  assert.equal(ask("http://192.168.1.5:47600/api/jobs"), 403, "another computer on the network");
  assert.equal(ask("http://127.0.0.1:47600/api/track", { method: "POST", origin: "https://evil.example" }), 403, "another website open in the browser");
  assert.equal(ask("http://127.0.0.1:47600/api/track", { method: "POST", origin: "http://127.0.0.1:47600" }), 200);
  assert.equal(ask("http://127.0.0.1:47600/api/ext/context", { origin: "chrome-extension://abc" }), 200, "the extension, whose routes check its code");
  assert.equal(ask("http://127.0.0.1:47600/api/profile", { method: "PUT", origin: "chrome-extension://abc" }), 403, "the extension outside its own routes");
});

test("the extension and the Claude connector need their codes", async () => {
  const ext = await import("../src/app/api/ext/[action]/route");
  const ctx = (action: string) => ({ params: Promise.resolve({ action }) });
  assert.equal((await ext.GET(new Request("http://127.0.0.1/api/ext/context?url=x"), ctx("context"))).status, 401);
  assert.equal((await ext.GET(new Request("http://127.0.0.1/api/ext/context?url=x", { headers: { "x-jobhunt-ext": "wrong" } }), ctx("context"))).status, 401);
  assert.equal((await ext.POST(new Request("http://127.0.0.1/api/ext/answers", { method: "POST", body: "{}" }), ctx("answers"))).status, 401);
  const { extToken } = await import("../src/lib/ext");
  assert.equal((await ext.GET(new Request("http://127.0.0.1/api/ext/context?url=x", { headers: { "x-jobhunt-ext": extToken() } }), ctx("context"))).status, 200);
  const mcp = await import("../src/app/api/mcp/route");
  const call = (token?: string) => mcp.POST(new Request("http://127.0.0.1/api/mcp", { method: "POST", headers: token ? { "x-jobhunt-token": token } : {}, body: JSON.stringify({ tool: "get_profile" }) }));
  assert.equal((await call()).status, 403);
  assert.equal((await call("0".repeat(48))).status, 403);
  const { writeRunFile } = await import("../src/lib/runfile");
  writeRunFile();
  const run = JSON.parse((await import("node:fs")).readFileSync(join(dir, "run.json"), "utf8")) as { token: string };
  assert.equal((await call(run.token)).status, 200);
});

test("the files with secrets in them can be read by this user only", () => {
  for (const f of ["keys.json", "run.json"]) {
    const mode = statSync(join(dir, f)).mode & 0o777;
    assert.equal(mode & 0o077, 0, `${f} is readable by others (${mode.toString(8)})`);
  }
});

test("a saved file is only ever shown from Downloads", async () => {
  const { POST } = await import("../src/app/api/documents/export/route");
  for (const reveal of ["/etc/passwd", join(homedir(), "Downloads", "..", ".ssh", "id_rsa"), join(homedir(), "Downloadsx", "a.pdf")]) {
    const r = await POST(new Request("http://127.0.0.1/api/documents/export", { method: "POST", body: JSON.stringify({ reveal }) }));
    assert.equal(r.status, 404, reveal);
  }
});

test("posting HTML cannot run code or load anything", async () => {
  const { sanitizeHtml } = await import("../src/lib/text");
  const out = sanitizeHtml(`<p onclick="steal()">Hi</p><script>steal()</script><img src=x onerror=steal()><a href="javascript:steal()">x</a>
    <iframe src="https://evil.example"></iframe><svg onload=steal()><circle/></svg><style>body{background:url(https://evil.example)}</style>
    &lt;script&gt;steal()&lt;/script&gt;<b style="x:expression(steal())">bold</b><form action="https://evil.example"><input name=p></form>`);
  assert.doesNotMatch(out, /<script|<iframe|<img|<svg|<style|<form|<input|\son\w+=|javascript:|href=|src=|style=|action=/i, out);
  assert.match(out, /Hi/);
  assert.match(out, /<b>bold<\/b>/);
});

test("the phone door lets in paired phones only, and passes nothing private through", async () => {
  // A stand-in for the app: it records what reaches it.
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const app = http.createServer((req, res) => { seen.push({ url: req.url ?? "", headers: req.headers }); res.writeHead(200, { "content-type": "text/plain" }); res.end("app"); });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const appPort = (app.address() as { port: number }).port;
  const phone = await import("../src/lib/phone");
  const logs: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    const status = await phone.setPhoneAccess(true, appPort);
    assert.ok(status.running, status.error ?? "phone access did not start");
    // The door is asked on loopback here, which it treats like the local network.
    const base = `http://127.0.0.1:${status.port}`;
    const ua = { "user-agent": "Mozilla/5.0 (Linux; Android 14)" };
    assert.equal((await fetch(`${base}/`, { headers: ua })).status, 401, "an unpaired phone");
    assert.equal((await fetch(`${base}/phone/pair?t=guess`, { headers: ua, redirect: "manual" })).status, 403, "a guessed code");
    const token = store.getMeta<string>("phonePairToken", "");
    const paired = await fetch(`${base}/phone/pair?t=${token}`, { headers: ua, redirect: "manual" });
    const cookie = (paired.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(paired.headers.get("set-cookie") ?? "", /HttpOnly/);
    const h = { ...ua, cookie, referer: `${base}/secret-page` };
    seen.length = 0;
    assert.equal((await fetch(`${base}/api/jobs`, { headers: h })).status, 200);
    for (const path of ["/settings", "/api/answers", "/api/ext/context", "/api/phone", "/api/reed", "/api/claude"]) {
      assert.equal((await fetch(`${base}${path}`, { headers: h })).status, 403, path);
    }
    assert.equal((await fetch(`${base}/api/ai`, { method: "PUT", headers: { ...h, origin: base }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/api/track`, { method: "POST", headers: { ...h, origin: "https://evil.example" }, body: "{}" })).status, 403, "another website");
    assert.deepEqual(seen.map((s) => s.url), ["/api/jobs"], "only the allowed request reached the app");
    const forwarded = seen[0].headers;
    assert.equal(forwarded.cookie, undefined, "the phone's session cookie is not passed on");
    assert.equal(forwarded.referer, undefined);
    assert.equal(forwarded.host, `localhost:${appPort}`);
    const session = cookie.split("=")[1];
    for (const line of logs) {
      assert.ok(!line.includes(token), "the pairing secret is in the log");
      assert.ok(!line.includes(session), "the phone's session is in the log");
    }
  } finally {
    console.log = log;
    await phone.setPhoneAccess(false, appPort);
    app.close();
  }
});

after(() => {
  store?.db().close();
});
