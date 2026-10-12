// The only part of the extension that talks to anything: the Jobhunt app on this computer, over loopback. Pages never
// see the pairing code or reach the app themselves; the content script asks this worker, and this worker answers.
// Nothing is ever sent to any other address.

// Where the app listens: the desktop app first, then `npm run dev`.
const PORTS = [47600, 47601, 47602, 47603, 3000, 3210];
let base = null;

const token = async () => (await chrome.storage.local.get("token")).token || "";

// The app can take a few seconds to answer while it is reading job boards. A port that refuses the connection
// answers at once ("closed"); one that accepts it and then says nothing in time is the app, busy ("busy").
async function ping(port, ms = 2500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ext/ping`, { headers: { "x-jobhunt-ext": await token() }, signal: AbortSignal.timeout(ms) });
    const body = await res.json();
    return body.app === "jobhunt" ? { port, paired: body.paired === true } : "closed";
  } catch (e) {
    return e && (e.name === "TimeoutError" || e.name === "AbortError") ? "busy" : "closed";
  }
}

// Chrome stops this worker when it is idle, so the port is kept for the browser session, not only in memory.
const remember = (port) => { base = port; chrome.storage.session?.set({ port }).catch(() => undefined); };

/** Finds the running app. { running, paired, busy }. */
async function status() {
  if (!base) base = (await chrome.storage.session?.get("port").catch(() => ({})))?.port || null;
  // The port that answered last time is asked first and given longer: the app is most likely still there.
  if (base) {
    for (const ms of [4000, 8000]) {
      const known = await ping(base, ms);
      if (known === "closed") break;
      if (known !== "busy") return { running: true, paired: known.paired };
    }
  }
  const hits = await Promise.all(PORTS.map((port) => ping(port)));
  const hit = hits.find((h) => typeof h === "object");
  if (hit) { remember(hit.port); return { running: true, paired: hit.paired }; }
  // Something holds one of the ports open without answering in time: wait for it rather than report "not open".
  const busyPort = PORTS.find((_, i) => hits[i] === "busy");
  if (busyPort) {
    const slow = await ping(busyPort, 10000);
    if (typeof slow === "object") { remember(slow.port); return { running: true, paired: slow.paired }; }
  }
  base = null;
  return { running: false, paired: false, busy: Boolean(busyPort) };
}

async function call(path, method = "GET", body) {
  if (!base && !(await status()).running) return { ok: false, status: 0, error: "Jobhunt is not open on this computer." };
  const ask = async () => {
    const res = await fetch(`http://127.0.0.1:${base}/api/ext/${path}`, {
      method,
      headers: { "x-jobhunt-ext": await token(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data.error || `Jobhunt answered ${res.status}.` };
  };
  try {
    return await ask();
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, status: 0, error: "Jobhunt is busy reading job boards and did not answer. Try again in a moment." };
    // The app may have been reopened on another port: look for it once and ask again.
    base = null;
    if (!(await status()).running) return { ok: false, status: 0, error: "Jobhunt is not open on this computer." };
    try { return await ask(); } catch { return { ok: false, status: 0, error: "Jobhunt did not answer. Try again in a moment." }; }
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
