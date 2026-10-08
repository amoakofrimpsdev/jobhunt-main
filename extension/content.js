// Jobhunt on an application page. This script does the work on the page (reads the form, fills it, records what the
// person types) and shows one small pill. The panel itself lives in Chrome's side panel, docked beside the page, and
// talks to this script by messages. Where the side panel cannot be opened, the same panel is drawn as a floating card
// in a shadow root, so the page's styles cannot reach it and it cannot disturb the page.
(async () => {
  "use strict";
  if (window.__jobhuntPanel) { window.__jobhuntPanel.open(); return; }
  const E = globalThis.JobhuntEngine;
  const V = globalThis.JobhuntView;
  if (!E || !V) return;

  const GONE = { ok: false, error: "The extension was reloaded. Refresh this page." };
  const send = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r || GONE); }); } catch { resolve(GONE); }
  });
  const api = (path, method, body) => send({ type: "api", path, method, body });

  const KNOWN = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkday|icims\.com|smartrecruiters\.com|workable\.com|bamboohr\.com|jobvite\.com|oraclecloud\.com|taleo\.net|recruitee\.com|applytojob\.com|breezy\.hr|rippling\.com/;
  const inFrame = window.top !== window;
  let fields = E.scan();
  if (inFrame) {
    // An embedded frame gets the panel only when the frame itself holds the form, which may render a moment late.
    for (let i = 0; i < 12 && !E.looksLikeApplication(fields); i++) { await new Promise((r) => setTimeout(r, 500)); fields = E.scan(); }
    if (!E.looksLikeApplication(fields)) return;
  }
  window.__jobhuntPanel = { open() { void act("open", {}); } };

  const frame = Math.random().toString(36).slice(2);
  const state = {
    // "pill": only the pill is on the page (the side panel, if open, shows the rest). "card": the floating fallback.
    mode: "pill", status: null, ctx: null, error: "", busy: "", results: null, resumeId: "",
    recorded: 0, demographics: false, saved: null, applied: false, filledOnce: false,
  };
  const seen = new WeakSet();

  /** The state as plain data, for the side panel. */
  const snapshot = () => ({
    frame, url: location.href, isForm: E.looksLikeApplication(fields), status: state.status, ctx: state.ctx, error: state.error,
    busy: state.busy, resumeId: state.resumeId, recorded: state.recorded, demographics: state.demographics, saved: state.saved,
    applied: state.applied, filledOnce: state.filledOnce,
    results: state.results && state.results.map((r) => ({ label: r.label, kind: r.kind, status: r.status, value: String(r.value || "").slice(0, 160) })),
  });

  // ---------------------------------------------------------------- what is drawn on the page

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host { all: initial; }
    ${V.CSS}
    .card { width: 340px; max-height: min(620px, calc(100vh - 32px)); display: flex; flex-direction: column; background: #fffaf0; border: 1px solid #e7e1d0; border-radius: 16px; box-shadow: 0 18px 50px -12px rgb(10 10 10 / .35); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e7e1d0; }
    .head b { flex: 1; font-size: 16px; font-weight: 500; letter-spacing: -.03em; color: #0a0a0a; }
    .x { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 8px; text-align: center; color: #6a6a6a; font-size: 18px; line-height: 26px; }
    .x:hover { background: #f5f0e0; color: #0a0a0a; }
    .body { padding: 14px; overflow-y: auto; }
    .pill { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 16px 0 10px; border-radius: 9999px; background: #0a0a0a; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 10px 30px -10px rgb(10 10 10 / .5); }
    .pill:hover { background: #2a2a2a; }
    .pill .n { padding: 2px 8px; border-radius: 9999px; background: #a4d4c5; color: #0a0a0a; }
  </style><div id="mount"></div>`;
  const mount = root.getElementById("mount");
  V.wire(mount, (name, payload) => void act(name, payload));

  function draw() {
    if (state.mode === "card") {
      mount.innerHTML = `<div class="card"><div class="head">${V.MARK}<b>Jobhunt</b><button class="x" data-a="close" title="Hide" aria-label="Hide">&times;</button></div><div class="body">${V.body(snapshot())}</div></div>`;
      return;
    }
    const score = state.ctx?.job?.score;
    const todo = state.results ? state.results.filter((r) => r.status === "needs" || r.status === "suggest").length : null;
    const words = todo !== null ? `${todo} left for you` : E.looksLikeApplication(fields) ? "Fill with Jobhunt" : "Jobhunt";
    mount.innerHTML = `<button class="pill" data-a="open" title="Open Jobhunt beside this page">${V.MARK}${words}${score != null ? `<span class="n">${score}%</span>` : ""}</button>`;
  }

  /** Redraws the page's part and tells the side panel, if it is open, what changed. */
  function update() {
    draw();
    try { chrome.runtime.sendMessage({ type: "jh:update", snap: snapshot() }, () => void chrome.runtime.lastError); } catch { /* the extension was reloaded */ }
  }

  // ---------------------------------------------------------------- actions

  async function connect() {
    state.error = "";
    state.status = await send({ type: "status" });
    update();
    if (state.status.running && state.status.paired) await loadContext();
  }

  async function loadContext() {
    const r = await api(`context?url=${encodeURIComponent(location.href)}`);
    if (!r.ok) {
      if (r.status === 401) state.status = { running: true, paired: false };
      else state.error = r.error;
      update();
      return;
    }
    state.ctx = r.data;
    state.demographics = r.data.recordDemographics;
    if (!state.resumeId || !r.data.resumes.some((x) => x.id === state.resumeId)) state.resumeId = r.data.resumes[0]?.id ?? "";
    update();
  }

  async function fill(onlyNew) {
    if (!state.ctx || state.busy) return;
    state.busy = "fill";
    state.error = "";
    update();
    fields = E.scan();
    let resume = null;
    if (state.resumeId) {
      const r = await api(`resume?id=${encodeURIComponent(state.resumeId)}`);
      if (r.ok) resume = r.data; else state.error = r.error;
    }
    const target = onlyNew ? fields.filter((f) => !seen.has(f.el)) : fields;
    const results = await E.fill(target, state.ctx.answers, { resume, demographics: state.demographics });
    fields.forEach((f) => seen.add(f.el));
    // A later step adds its lines to the list; a fresh fill replaces it.
    state.results = onlyNew && state.results ? [...state.results.filter((r) => r.field.el.isConnected), ...results] : results;
    state.filledOnce = true;
    state.busy = "";
    const used = results.filter((r) => r.usedKey).map((r) => r.usedKey);
    if (used.length) void api("used", "POST", { keys: used });
    update();
  }

  async function saveJob() {
    state.busy = "save";
    update();
    const r = await api("save-job", "POST", E.pageJob());
    state.busy = "";
    if (!r.ok) { state.error = r.error; update(); return; }
    state.saved = r.data.followed ? `Following ${r.data.followed}. Reading its board…` : "Saved to Jobhunt.";
    update();
    // A followed board takes a moment to be read; the job then shows up with its score.
    for (let i = 0; i < 8 && !state.ctx?.job; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      await loadContext();
    }
    if (!state.ctx?.job && r.data.followed) { state.saved = `Following ${r.data.followed}. Its jobs are in Jobhunt, but this posting was not among them (it may be closed or unlisted).`; update(); }
  }

  /** Shows a field the person still has to answer; a saved long answer is written in when they ask for it. */
  function goToLine(i) {
    const r = state.results && state.results[i];
    if (!r) return;
    const el = r.field.el;
    if (r.status === "suggest" && (r.kind === "text" || r.kind === "textarea")) {
      const setter = Object.getOwnPropertyDescriptor((el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement).prototype, "value").set;
      el.focus(); setter.call(el, r.value);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      r.status = "filled";
    }
    const shown = el.offsetParent ? el : el.closest("label, div") || el;
    shown.scrollIntoView({ block: "center", behavior: "smooth" });
    const old = shown.style.outline;
    shown.style.outline = "3px solid #ff4d8b";
    setTimeout(() => { shown.style.outline = old; }, 1600);
    if (el.focus && r.kind !== "file") el.focus({ preventScroll: true });
    update();
  }

  /** Everything the panel can ask for, whether it is the side panel or the card on the page. */
  async function act(name, p) {
    switch (name) {
      case "open": {
        if (!state.status) void connect();
        // The click on the pill is what lets Chrome open its side panel. Without one, the card opens here instead.
        const r = await send({ type: "open-panel" });
        state.mode = r && r.ok ? "pill" : "card";
        return update();
      }
      case "close": state.mode = "pill"; return update();
      case "retry": return connect();
      case "pair":
        state.status = await send({ type: "pair", code: p.code });
        state.error = state.status.running && !state.status.paired ? "That code was not accepted. Copy it again from Settings." : "";
        update();
        if (state.status.paired) await loadContext();
        return;
      case "fill": return fill(false);
      case "save": return saveJob();
      case "applied": {
        if (!state.ctx?.job) return;
        const r = await api("applied", "POST", { jobId: state.ctx.job.id });
        state.applied = r.ok;
        if (!r.ok) state.error = r.error;
        return update();
      }
      case "resume": state.resumeId = p.id; return update();
      case "demo": state.demographics = p.on; void api("demographics", "POST", { on: p.on }); return update();
      case "line": return goToLine(p.i);
      default:
    }
  }

  // The side panel asks this page for its state and passes on what the person does there. A page can hold several
  // frames with this script: the frame that holds the form answers at once and the outer page a moment later, so
  // the form wins; after that the panel names the frame it is talking to.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("jh:")) return false;
    if (msg.type === "jh:get") {
      if (!state.status) void connect();
      setTimeout(() => reply(snapshot()), E.looksLikeApplication(fields) ? 0 : 200);
      return true;
    }
    if (msg.type === "jh:act" && msg.frame === frame) {
      void act(msg.action, msg.payload || {});
      reply({ ok: true });
    }
    return false;
  });

  // ---------------------------------------------------------------- recording

  const pending = new Map();
  let flush = null;
  E.record((a) => {
    if (a.demographic && !state.demographics) return;
    if (!state.status?.paired) return;
    pending.set(a.key, { key: a.key, label: a.label, value: a.value, kind: a.kind });
    clearTimeout(flush);
    flush = setTimeout(async () => {
      const items = [...pending.values()];
      pending.clear();
      const r = await api("answers", "POST", { items, site: location.host });
      if (!r.ok) return;
      state.recorded += r.data.saved;
      // The answers just given are used by the next fill on this page too.
      if (state.ctx) for (const it of items) { const at = state.ctx.answers.findIndex((x) => x.key === it.key); if (at >= 0) state.ctx.answers[at] = it; else state.ctx.answers.push(it); }
      update();
    }, 1500);
  });

  // ---------------------------------------------------------------- pages that change under us

  // Multi-step applications (Workday) swap the form in place: once the person has pressed Fill, each new step is
  // filled as it appears. Single-page apps also change the address without loading a page.
  let timer = null;
  let lastUrl = location.href;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (location.href !== lastUrl) { lastUrl = location.href; state.results = null; state.saved = null; state.applied = false; if (state.status?.paired) await loadContext(); }
      const now = E.scan();
      const fresh = now.filter((f) => !seen.has(f.el));
      const wasForm = E.looksLikeApplication(fields);
      fields = now;
      if (state.filledOnce && fresh.length && state.busy === "") await fill(true);
      else if (wasForm !== E.looksLikeApplication(now)) update();
    }, 900);
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.documentElement.appendChild(host);
  draw();
  // On a known application site the pill shows the match straight away; elsewhere it waits to be asked.
  if (E.looksLikeApplication(fields) || KNOWN.test(location.host)) void connect();
})();
