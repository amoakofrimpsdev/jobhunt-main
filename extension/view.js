// How the Jobhunt panel looks, shared by its two homes: Chrome's side panel (sidepanel.html) and the floating card
// the page falls back to when the side panel cannot be opened. It draws a plain snapshot of the content script's
// state and reports what the person does through `act(name, payload)`; it never touches the page's form itself.
(() => {
  "use strict";
  if (globalThis.JobhuntView) return;

  const MARK = `<svg width="22" height="22" viewBox="0 0 30 30"><rect x="1" y="12" width="17" height="17" rx="6" fill="#1a3a3a"/><circle cx="20" cy="10" r="9" fill="#ff4d8b"/><circle cx="11" cy="20" r="5" fill="#e8b94a"/></svg>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
    * { box-sizing: border-box; font-family: -apple-system, "Inter", "Segoe UI", Roboto, sans-serif; }
    .jh { color: #3a3a3a; font-size: 13px; line-height: 1.45; }
    .jh p { margin: 0; }
    .job { padding: 12px; border-radius: 12px; background: #b8a4ed; color: #0a0a0a; }
    .job.none { background: #f5f0e0; }
    .job .t { font-weight: 600; font-size: 14px; }
    .job .s { opacity: .8; }
    .score { float: right; margin-left: 8px; font-weight: 600; font-size: 20px; letter-spacing: -.03em; }
    .warn { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #ffe0dc; color: #8a1f14; font-weight: 500; }
    label { display: block; margin: 12px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #6a6a6a; }
    select, input[type=text] { width: 100%; height: 38px; padding: 0 10px; border-radius: 10px; border: 1px solid #e7e1d0; background: #fff; color: #0a0a0a; font-size: 13px; }
    select:focus, input:focus { outline: none; border-color: #0a0a0a; }
    button.p, button.q { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 16px; border-radius: 12px; font-size: 14px; font-weight: 600; white-space: nowrap; }
    button.p { background: #0a0a0a; color: #fff; }
    button.p:hover { background: #2a2a2a; }
    button.p.wide { display: flex; width: 100%; margin-top: 12px; }
    button.q { background: #fff; color: #0a0a0a; border: 1px solid #e7e1d0; height: 34px; padding: 0 12px; font-size: 13px; }
    button[disabled] { opacity: .5; cursor: default; }
    .row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .tip { margin-top: 6px; color: #6a6a6a; font-size: 12px; }
    .sum { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: #a4d4c5; color: #0a0a0a; font-weight: 600; }
    ul { list-style: none; margin: 8px 0 0; padding: 0; }
    li { padding: 8px 10px; border-radius: 10px; background: #fff; border: 1px solid #e7e1d0; margin-top: 6px; cursor: pointer; }
    li:hover { border-color: #0a0a0a; }
    li .l { color: #0a0a0a; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    li .v { color: #6a6a6a; font-size: 12px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .rec { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e7e1d0; color: #6a6a6a; font-size: 12px; }
    .rec b, .strong { color: #0a0a0a; font-weight: 600; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff4d8b; margin-right: 6px; }
    .chk { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0 0; cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 12px; }
    .err { margin-top: 10px; color: #8a1f14; font-weight: 500; }
    svg { flex: none; }`;

  const BLOCKER = { no_sponsorship: "This posting says it does not sponsor visas.", citizenship: "This posting asks for US citizenship.", clearance: "This posting asks for a security clearance." };

  function ready(s) {
    const c = s.ctx;
    const j = c.job;
    let h = "";
    if (j) {
      h += `<div class="job">${j.score != null ? `<span class="score">${j.score}%</span>` : ""}<div class="t">${esc(j.title)}</div><div class="s">${esc(j.company)}${j.status ? ` · ${esc(j.status)}` : ""}</div></div>`;
      if (j.blocker) h += `<div class="warn">${BLOCKER[j.blocker] || ""}</div>`;
    } else if (s.saved) {
      h += `<div class="job none"><div class="t">${esc(s.saved)}</div></div>`;
    } else {
      h += `<div class="job none"><div class="t">This job is not in Jobhunt yet</div><div class="s">${c.canFollowBoard ? "Save it and Jobhunt follows this employer's whole board." : "Save it to track it and score it."}</div>
        <div class="row"><button class="q" data-a="save" ${s.busy ? "disabled" : ""}>${s.busy === "save" ? "Saving…" : "Save job to Jobhunt"}</button></div></div>`;
    }

    if (s.isForm) {
      if (c.resumes.length) {
        const best = c.resumes[0];
        h += `<label for="resume">Resume to attach</label><select id="resume">${c.resumes.map((r) => `<option value="${esc(r.id)}" ${r.id === s.resumeId ? "selected" : ""}>${esc(r.name)}${r.score != null ? ` · ${r.score}%` : ""}</option>`).join("")}<option value="" ${s.resumeId === "" ? "selected" : ""}>Do not attach a resume</option></select>`;
        if (best.score != null && c.resumes.length > 1) h += `<div class="tip">${s.resumeId === best.id ? `${esc(best.name)} fits this job best.` : `${esc(best.name)} fits this job better (${best.score}%).`}</div>`;
      } else h += `<div class="tip" style="margin-top:12px">Add a resume on Jobhunt's Profile page and it will be attached for you.</div>`;
      h += `<button class="p wide" data-a="fill" ${s.busy ? "disabled" : ""}>${s.busy === "fill" ? "Filling…" : s.filledOnce ? "Fill again" : "Fill application"}</button>`;
    } else if (!s.results) {
      h += `<div class="tip" style="margin-top:12px">No application form on this page yet. Open the application and the Fill button appears.</div>`;
    }

    if (s.results) {
      const done = s.results.filter((r) => r.status === "filled").length;
      const kept = s.results.filter((r) => r.status === "kept").length;
      const todo = s.results.map((r, i) => ({ ...r, i })).filter((r) => r.status === "needs" || r.status === "suggest");
      h += `<div class="sum">Filled ${done}${kept ? ` · ${kept} already had an answer` : ""} · ${todo.length} left for you</div>`;
      if (todo.length) {
        h += `<ul>${todo.map((r) => `<li data-i="${r.i}"><div class="l">${esc(r.label)}</div>${r.status === "suggest" ? `<div class="v">You answered before: ${esc(r.value)} — click to use it</div>` : r.kind === "file" ? `<div class="v">Choose a file</div>` : ""}</li>`).join("")}</ul>`;
        h += `<div class="tip">Click one to jump to it on the page. Jobhunt remembers what you type, so next time it is filled too.</div>`;
      }
      h += `<div class="tip">Check everything, then submit yourself. Jobhunt never presses Submit.</div>`;
      if (j && !s.applied && j.status !== "applied") h += `<div class="row"><button class="q" data-a="applied">I submitted it · mark applied</button></div>`;
      if (s.applied) h += `<div class="tip"><span class="strong">Marked as applied in Jobhunt.</span></div>`;
    }

    h += `<div class="rec"><span class="dot"></span><b>Recording your answers</b>${s.recorded ? ` · ${s.recorded} saved` : ""}<br>What you type on this page is saved in the Jobhunt app on this computer, never passwords or ID numbers.
      <label class="chk"><input type="checkbox" id="demo" ${s.demographics ? "checked" : ""}> Also remember and fill voluntary demographic answers</label></div>`;
    return h;
  }

  /** The panel's body for one snapshot of the content script's state. */
  function body(s) {
    let h;
    const st = s.status;
    if (!st) h = `<p>Looking for Jobhunt…</p>`;
    else if (!st.running) h = `<p><span class="strong">Jobhunt is not open.</span> Open the Jobhunt app on this computer, then try again.</p><button class="p wide" data-a="retry">Try again</button>`;
    else if (!st.paired) h = `<p><span class="strong">Pair with Jobhunt.</span> In the app, open Settings, copy the pairing code and paste it here. It stays in this browser and is only ever sent to the app on this computer.</p>
      <input type="text" id="code" placeholder="Pairing code" autocomplete="off" spellcheck="false" style="margin-top:10px"><button class="p wide" data-a="pair">Pair</button>`;
    else if (!s.ctx) h = `<p>Reading this page…</p>`;
    else h = ready(s);
    return `<div class="jh">${h}${s.error ? `<div class="err">${esc(s.error)}</div>` : ""}</div>`;
  }

  /** Reports clicks and changes inside `el` as actions. */
  function wire(el, act) {
    el.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const line = t.closest("li[data-i]");
      if (line) return act("line", { i: Number(line.dataset.i) });
      const a = t.closest("[data-a]")?.dataset.a;
      if (a === "pair") return act("pair", { code: el.querySelector("#code")?.value || "" });
      if (a) act(a, {});
    });
    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "resume") act("resume", { id: t.value });
      if (t.id === "demo") act("demo", { on: t.checked });
    });
  }

  globalThis.JobhuntView = { MARK, CSS, body, wire, esc };
})();
