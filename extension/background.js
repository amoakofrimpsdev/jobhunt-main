// The only part of the extension that talks to anything: the Jobhunt app on this computer, over loopback. Pages never
// see the pairing code or reach the app themselves; the content script asks this worker, and this worker answers.
// Nothing is ever sent to any other address.

// Where the app listens: the desktop app first, then `npm run dev`.
const PORTS = [47600, 47601, 47602, 47603, 3000, 3210];
let base = null;

const token = async () => (await chrome.storage.local.get("token")).token || "";

async function ping(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ext/ping`, { headers: { "x-jobhunt-ext": await token() }, signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body.app === "jobhunt" ? { port, paired: body.paired === true } : null;
  } catch {
    return null;
  }
}

/** Finds the running app. { running, paired }. */
async function status() {
  const known = base ? await ping(base) : null;
  if (known) return { running: true, paired: known.paired };
  base = null;
  for (const port of PORTS) {
    const hit = await ping(port);
    if (hit) { base = port; return { running: true, paired: hit.paired }; }
  }
  return { running: false, paired: false };
}

async function call(path, method = "GET", body) {
  if (!base && !(await status()).running) return { ok: false, status: 0, error: "Jobhunt is not open on this computer." };
  try {
    const res = await fetch(`http://127.0.0.1:${base}/api/ext/${path}`, {
      method,
      headers: { "x-jobhunt-ext": await token(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data.error || `Jobhunt answered ${res.status}.` };
  } catch {
    base = null;
    return { ok: false, status: 0, error: "Jobhunt is not open on this computer." };
  }
}

// The toolbar icon keeps its small popup (pairing, "Use on this page"); the side panel opens from the pill on the
// page or from the popup's button.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Messages between the page and the side panel pass by; they are not for this worker.
  if (typeof msg?.type === "string" && msg.type.startsWith("jh:")) return false;
  if (msg.type === "open-panel") {
    // Chrome opens its side panel only while the click that asked for it is still being handled, so this is
    // called at once, before anything is awaited. An older Chrome without the side panel answers "no".
    if (!chrome.sidePanel?.open || !sender.tab?.id) { reply({ ok: false }); return false; }
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  (async () => {
    if (msg.type === "status") return reply(await status());
    if (msg.type === "pair") {
      await chrome.storage.local.set({ token: String(msg.code || "").trim() });
      return reply(await status());
    }
    if (msg.type === "api") return reply(await call(msg.path, msg.method, msg.body));
    reply({ ok: false, error: "Unknown message." });
  })();
  return true;
});
