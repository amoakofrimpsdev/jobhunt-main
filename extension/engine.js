// Jobhunt's form engine: finds the fields of an application form, works out what each one asks, fills them, and
// records what the person types. Plain DOM code with no browser-extension calls, so it can be run and tested in any
// page. It never presses Submit, Next or Apply, never touches a password, card or captcha field, and never unticks
// or ticks a consent box.
(() => {
  "use strict";
  if (globalThis.JobhuntEngine) return;

  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/, "").replace(/\((?:required|optional)\)/gi, "").trim();
  const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- what a field asks

  // Never read, filled or recorded.
  const FORBIDDEN = /pass(?:word|code)|\bssn\b|social security|passport|date of birth|\bdob\b|birth ?(?:date|day)|credit card|card number|\bcvv\b|\bcvc\b|bank|routing|iban|driver'?s? licen[cs]e|national id|tax id|captcha|security (?:code|question)/i;
  // Voluntary self-identification: only filled from answers the person chose to keep.
  const DEMOGRAPHIC = /\bgender\b|\bsex\b|\brace\b|ethnic|hispanic|latino|veteran|disabilit|sexual orientation|transgender|lgbt/i;
  const CONSENT = /\bi (?:agree|consent|acknowledge|certify|understand|have read)|privacy (?:policy|notice)|terms (?:of|and)|data processing|gdpr|subscribe|newsletter|marketing|text messages?|sms/i;

  // The details with a fixed meaning, most specific first. The first rule that matches the question wins.
  const RULES = [
    ["preferred_name", /\bpreferred (?:first )?name\b|\bnickname\b|what should we call you/],
    ["first_name", /\bfirst name\b|\bgiven name\b|\bforename\b/],
    ["last_name", /\blast name\b|\bfamily name\b|\bsurname\b/],
    ["full_name", /^(?:full |legal |your )?name$|\bfull name\b|\blegal name\b/],
    ["email", /\be ?mail\b/],
    ["phone", /\bphone\b|\bmobile\b|\bcell\b|\btelephone\b/],
    ["linkedin", /\blinked ?in\b/],
    ["github", /\bgit ?hub\b/],
    ["website", /\bwebsite\b|\bportfolio\b|\bpersonal site\b|\bother (?:url|link)\b|^url$/],
    ["needs_sponsorship", /sponsor/],
    ["work_authorized", /authori[sz]ed to work|legally (?:authori[sz]ed|eligible|able|permitted)|eligible to work|right to work|work authori[sz]ation|permitted to work/],
    ["zip", /\bzip\b|\bpostal code\b|\bpostcode\b/],
    ["address", /\bstreet\b|\baddress(?: line)?(?: 1)?$|^address\b/],
    ["country", /^country\b|\bcountry of residence\b|(?:which|what) country/],
    ["city", /\bcity\b|\blocation\b|where are you (?:based|located)|\bcurrent(?:ly)? (?:located|based)\b/],
    ["current_company", /\bcurrent (?:company|employer)\b|\bemployer\b|^company(?: name)?$|^org(?:ani[sz]ation)?$/],
    ["current_title", /\bcurrent (?:title|role|position)\b|^(?:job )?title$/],
    ["school", /\bschool\b|\buniversity\b|\bcollege\b|\binstitution\b/],
    ["degree", /\bdegree\b|\blevel of education\b|\beducation level\b/],
    ["major", /\bmajor\b|\bfield of study\b|\bdiscipline\b|\barea of study\b/],
    ["graduation_year", /\bgraduat(?:ion|e|ing)\b.*\b(?:year|date)\b|\bgrad year\b|\byear of graduation\b/],
    ["salary", /\bsalary\b|\bcompensation\b|\bpay expectation|\bdesired pay\b/],
    ["start_date", /\bstart date\b|\bnotice period\b|\bwhen can you start\b|\bavailab(?:le|ility) to start\b|\bearliest\b/],
    ["pronouns", /\bpronouns?\b/],
    ["how_heard", /how did you (?:hear|find|learn)|where did you (?:hear|find)|\bsource\b|\breferr?al source\b/],
  ];

  const LONG_OK = new Set(["needs_sponsorship", "work_authorized", "how_heard", "linkedin", "github"]);

  /** The standard detail a question asks for, or a key made from its wording. */
  function keyFor(label, el) {
    const text = norm(label);
    const auto = (el && el.getAttribute && el.getAttribute("autocomplete")) || "";
    const byAuto = { "given-name": "first_name", "family-name": "last_name", name: "full_name", email: "email", tel: "phone", "postal-code": "zip", "street-address": "address", "address-line1": "address", country: "country", "country-name": "country", "address-level2": "city", organization: "current_company", "organization-title": "current_title", url: "website" }[auto];
    if (byAuto) return byAuto;
    if (el && el.type === "email") return "email";
    if (el && el.type === "tel") return "phone";
    // A long question that happens to contain "degree" or "location" is its own question, not the standard detail.
    // Only the details that are always asked as a full sentence are looked for in long questions.
    const brief = text.split(" ").length <= 6;
    for (const [key, re] of RULES) if ((brief || LONG_OK.has(key)) && re.test(text)) return key;
    return text ? `q:${text.slice(0, 200)}` : "";
  }

  // ---------------------------------------------------------------- finding fields

  function textOf(node) {
    if (!node) return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button, [role=listbox], [role=option], svg, style, script, [aria-hidden=true]").forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  /** The nearest block around a control that reads like one question. */
  function containerOf(el) {
    return el.closest("fieldset, [role=group], [role=radiogroup], [class*='field' i], [class*='question' i], [class*='form-group' i], [class*='FormField' i], [data-automation-id^='formField'], li, .application-question") || el.parentElement;
  }

  function labelOf(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const byIds = clean(ids.map((id) => document.getElementById(id)?.textContent || "").join(" "));
    if (byIds) return byIds;
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && textOf(lab)) return textOf(lab);
    }
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    const aria = clean(el.getAttribute("aria-label"));
    if (aria && !/^(?:select|search|choose|type here|toggle)/i.test(aria)) return aria;
    const box = containerOf(el);
    if (box) {
      const head = box.querySelector("legend, label, [class*='label' i], [class*='question' i], h3, h4, h5, p");
      if (head && textOf(head)) return textOf(head);
    }
    return clean(el.getAttribute("placeholder")) || aria || clean((el.getAttribute("name") || el.id || "").replace(/[_\-[\]]+/g, " "));
  }

  /** The question a group of choices answers (the legend, not one choice's own label). */
  function groupLabel(el) {
    const box = el.closest("fieldset, [role=group], [role=radiogroup]") || containerOf(containerOf(el) || el);
    if (!box) return labelOf(el);
    const ids = (box.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const byIds = clean(ids.map((id) => document.getElementById(id)?.textContent || "").join(" "));
    if (byIds) return byIds;
    const head = box.querySelector("legend, [class*='label' i]:not(label), [class*='question' i], h3, h4, h5, label:not(:has(input))");
    return (head && textOf(head)) || clean(box.getAttribute("aria-label")) || labelOf(el);
  }

  const YESNO = /^(?:yes|no)\b/i;

  /**
   * Every fillable field under `root`, one entry per question:
   * { kind, el, label, key, options?, els? }. kind: text, textarea, select, combobox, radio, checkbox, buttons, file.
   */
  function scan(root = document) {
    const out = [];
    const taken = new Set();
    const push = (f) => {
      f.label = clean(f.label).slice(0, 300);
      if (!f.label || FORBIDDEN.test(f.label)) return;
      f.key = keyFor(f.label, f.el);
      f.demographic = DEMOGRAPHIC.test(f.label);
      out.push(f);
    };

    for (const el of root.querySelectorAll("input, textarea, select, [role=combobox], button[aria-haspopup=listbox]")) {
      if (taken.has(el) || el.disabled || el.readOnly && el.getAttribute("role") !== "combobox") continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "password", "submit", "button", "reset", "image", "search", "range", "color"].includes(type)) continue;
      if (el.closest("[class*='captcha' i], [id*='captcha' i], [role=search], nav, header nav")) continue;

      if (type === "file") {
        // File inputs are usually hidden behind a button; their question is still readable.
        push({ kind: "file", el, label: groupLabel(el) || labelOf(el) || "Attachment" });
        continue;
      }
      if (type === "radio") {
        const name = el.getAttribute("name");
        const set = name ? [...root.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)] : [el];
        set.forEach((r) => taken.add(r));
        if (!set.some(visible) && !set.some((r) => visible(r.closest("label") || r.parentElement))) continue;
        push({ kind: "radio", el: set[0], els: set, label: groupLabel(el), options: set.map((r) => labelOf(r)) });
        continue;
      }
      if (type === "checkbox") {
        const box = el.closest("fieldset, [role=group]");
        const set = box ? [...box.querySelectorAll("input[type=checkbox]")] : [el];
        if (set.length > 1) {
          set.forEach((r) => taken.add(r));
          push({ kind: "checkbox", el: set[0], els: set, label: groupLabel(el), options: set.map((r) => labelOf(r)) });
        } else {
          push({ kind: "checkbox", el, els: [el], label: labelOf(el), options: [labelOf(el)], consent: CONSENT.test(labelOf(el)) });
        }
        continue;
      }
      if (!visible(el)) continue;
      const isCombobox = el.getAttribute("role") === "combobox" || el.matches("button[aria-haspopup=listbox]");
      // A custom dropdown keeps a second, inert input beside the one the person uses (it carries the value for the
      // form). It is not a question of its own.
      if (!isCombobox && (el.tabIndex === -1 || el.getAttribute("aria-hidden") === "true" || el.closest("[class*='select__' i], [class*='-container' i][class*='select' i]"))) continue;
      if (isCombobox) {
        push({ kind: "combobox", el, label: labelOf(el) });
        continue;
      }
      if (tag === "select") {
        push({ kind: "select", el, label: labelOf(el), options: [...el.options].map((o) => clean(o.textContent)) });
        continue;
      }
      push({ kind: tag === "textarea" ? "textarea" : "text", el, label: labelOf(el) });
    }

    // Yes / No pairs drawn as buttons (Ashby).
    for (const b of root.querySelectorAll("button")) {
      if (taken.has(b) || !YESNO.test(clean(b.textContent)) || !visible(b)) continue;
      const set = [...b.parentElement.querySelectorAll(":scope > button")].filter((x) => clean(x.textContent).length < 40);
      if (set.length < 2 || set.length > 4 || !set.every((x) => visible(x))) continue;
      set.forEach((x) => taken.add(x));
      const label = clean(groupLabel(set[0]));
      // The buttons stand in for a hidden checkbox that carries the same question: the buttons are the field.
      for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === "checkbox" && out[i].label === label.slice(0, 300)) out.splice(i, 1);
      push({ kind: "buttons", el: set[0], els: set, label, options: set.map((x) => clean(x.textContent)) });
    }
    return out;
  }

  // ---------------------------------------------------------------- reading a field

  function valueOf(f) {
    switch (f.kind) {
      case "text": case "textarea": return f.el.value.trim();
      case "select": return f.el.selectedIndex > 0 || (f.el.value && !/^(?:select|choose|please|--)/i.test(clean(f.el.selectedOptions[0]?.textContent))) ? clean(f.el.selectedOptions[0]?.textContent) : "";
      case "radio": { const i = f.els.findIndex((r) => r.checked); return i >= 0 ? f.options[i] : ""; }
      case "checkbox": return f.els.map((c, i) => (c.checked ? f.options[i] : "")).filter(Boolean).join("; ");
      case "buttons": { const b = f.els.find((x) => x.getAttribute("aria-pressed") === "true" || x.getAttribute("aria-checked") === "true" || /\b(?:active|selected|checked)\b/i.test(x.className)); return b ? clean(b.textContent) : ""; }
      case "combobox": {
        if (f.el.tagName === "INPUT" && f.el.value.trim()) return f.el.value.trim();
        const shown = containerOf(f.el)?.querySelector("[class*='single-value' i], [class*='singleValue' i], [class*='selected' i]:not([role=option])");
        const t = clean(shown?.textContent) || (f.el.tagName === "BUTTON" ? clean(f.el.textContent) : "");
        return /^(?:select|choose|please|search)\b|^$/i.test(t) ? "" : t;
      }
      case "file": return f.el.files && f.el.files.length ? f.el.files[0].name : "";
      default: return "";
    }
  }

  // ---------------------------------------------------------------- writing a field

  function fire(el, type, init = {}) {
    const E = /^(?:mouse|click|pointer)/.test(type) ? MouseEvent : /^key/.test(type) ? KeyboardEvent : Event;
    el.dispatchEvent(new E(type, { bubbles: true, cancelable: true, composed: true, view: window, ...init }));
  }

  function click(el) {
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) fire(el, t, { button: 0 });
    el.click();
  }

  /** Sets a text value the way typing would, so React, Vue and Angular forms all notice. */
  function setText(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    fire(el, "input", { inputType: "insertText", data: value });
    fire(el, "change");
  }

  const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 1));

  /** The option that best says `want`: the same text, then a Yes/No lead, then the most shared words. -1 = none. */
  function pick(options, want) {
    const w = norm(want);
    if (!w) return -1;
    const o = options.map(norm);
    let i = o.indexOf(w);
    if (i >= 0) return i;
    if (w === "yes" || w === "no") {
      i = o.findIndex((x) => x === w || x.startsWith(`${w} `));
      if (i >= 0) return i;
    }
    i = o.findIndex((x) => x && (x.startsWith(w) || w.startsWith(x)));
    if (i >= 0) return i;
    i = o.findIndex((x) => x.includes(w));
    if (i >= 0) return i;
    const ww = words(want);
    let best = -1, score = 0;
    o.forEach((x, k) => {
      const xw = words(x);
      const shared = [...ww].filter((t) => xw.has(t)).length;
      const s = shared / Math.max(1, Math.min(ww.size, xw.size));
      if (shared && s > score) { score = s; best = k; }
    });
    return score >= 0.6 ? best : -1;
  }

  const openOptions = () => [...document.querySelectorAll("[role=option], [role=listbox] li, [class*='select__option' i], [data-automation-id=promptOption]")].filter(visible);

  async function fillCombobox(f, want) {
    const el = f.el;
    const control = el.closest("[class*='control' i]") || el;
    el.focus();
    click(control);
    if (el.tagName === "INPUT") {
      // Typing narrows a long list (countries, schools, cities) to the answer.
      setText(el, want);
      fire(el, "keydown", { key: "ArrowDown", code: "ArrowDown" });
    }
    let opts = [];
    for (let i = 0; i < 12; i++) {
      await sleep(150);
      opts = openOptions();
      if (opts.length && (el.tagName !== "INPUT" || i >= 2)) break;
    }
    let idx = pick(opts.map((o) => o.textContent), want);
    if (idx < 0 && el.tagName === "INPUT" && opts.length && norm(want).length > 3) {
      // A search box that already narrowed to the typed text: its first hit is the answer ("Seattle" -> "Seattle, WA, USA").
      const first = norm(opts[0].textContent);
      if (first.includes(norm(want).split(" ")[0])) idx = 0;
    }
    if (idx < 0) {
      fire(el, "keydown", { key: "Escape", code: "Escape" });
      if (el.tagName === "INPUT") setText(el, "");
      document.body.click();
      return false;
    }
    click(opts[idx]);
    await sleep(80);
    return true;
  }

  async function attach(f, file) {
    if (!file) return false;
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.mime }));
    f.el.files = dt.files;
    fire(f.el, "input");
    fire(f.el, "change");
    await sleep(50);
    return f.el.files.length > 0;
  }

  async function write(f, value, file) {
    switch (f.kind) {
      case "text": case "textarea": setText(f.el, value); return true;
      case "select": {
        const i = pick(f.options, value);
        if (i < 0) return false;
        f.el.selectedIndex = i;
        fire(f.el, "input"); fire(f.el, "change");
        return true;
      }
      case "radio": case "buttons": {
        const i = pick(f.options, value);
        if (i < 0) return false;
        const target = f.els[i];
        click(f.kind === "radio" && !visible(target) ? target.closest("label") || target : target);
        if (f.kind === "radio" && !target.checked) target.click();
        return true;
      }
      case "checkbox": {
        if (f.consent) return false;
        let done = false;
        for (const part of value.split(/;\s*/)) {
          const i = f.els.length === 1 ? (/^(?:yes|true|on)$/i.test(part) ? 0 : -1) : pick(f.options, part);
          if (i >= 0 && !f.els[i].checked) { f.els[i].click(); done = true; } else if (i >= 0) done = true;
        }
        return done;
      }
      case "combobox": return fillCombobox(f, value);
      case "file": return attach(f, file);
      default: return false;
    }
  }

  // ---------------------------------------------------------------- answers

  /** Builds the lookup the filler uses from the answers the app holds. */
  function answerBook(answers) {
    const byKey = new Map(answers.map((a) => [a.key, a]));
    const get = (k) => byKey.get(k)?.value || "";
    const full = [get("first_name"), get("last_name")].filter(Boolean).join(" ");
    const recorded = answers.filter((a) => a.key.startsWith("q:")).map((a) => ({ ...a, words: words(a.key.slice(2)) }));
    return {
      /** { value, key, suggest } for a field, or null when nothing is known. */
      find(f) {
        if (f.kind === "file") return null;
        if (f.key === "full_name") return full ? { value: full, key: "first_name" } : null;
        if (f.key === "city" && f.kind !== "text" && f.kind !== "combobox" && get("country")) return byKey.has("city") ? { value: get("city"), key: "city" } : null;
        const direct = byKey.get(f.key);
        if (direct && direct.value) {
          // A long written answer was for one employer: offered, not filled in by itself.
          return { value: direct.value, key: direct.key, suggest: f.key.startsWith("q:") && direct.value.length > 160 };
        }
        if (!f.key.startsWith("q:")) return null;
        const mine = words(f.key.slice(2));
        if (mine.size < 3) return null;
        let best = null, score = 0;
        for (const a of recorded) {
          const shared = [...mine].filter((w) => a.words.has(w)).length;
          const s = shared / Math.max(mine.size, a.words.size);
          if (s > score) { score = s; best = a; }
        }
        return best && score >= 0.8 ? { value: best.value, key: best.key, suggest: best.value.length > 160 } : null;
      },
    };
  }

  // The first upload that is not plainly for something else (a cover letter, a transcript, a photo) takes the resume.
  // "Autofill from resume" is a helper that overwrites the form, not the upload the employer receives.
  const isResumeField = (f) => f.kind === "file" && !/cover|transcript|portfolio|writing sample|reference|photo|picture|headshot|additional|other|autofill|import|parse/i.test(f.label);

  /**
   * Fills every empty field it has an answer for. Returns one line per field:
   * { label, key, status, value } with status filled | kept (already had a value) | needs | suggest | skipped.
   */
  async function fill(fields, answers, { resume = null, demographics = false } = {}) {
    const book = answerBook(answers);
    const results = [];
    // The upload named "Resume" or "CV" takes the file; without one, the first upload that could be it.
    const named = fields.find((x) => isResumeField(x) && /resume|\bcv\b|curriculum/i.test(x.label));
    const resumeField = named || fields.find(isResumeField) || null;
    for (const f of fields) {
      const line = { label: f.label, key: f.key, kind: f.kind, status: "needs", value: "", field: f };
      results.push(line);
      try {
        const current = valueOf(f);
        if (current) { line.status = "kept"; line.value = current; continue; }
        if (f.kind === "file") {
          if (f === resumeField && resume) {
            if (await attach(f, resume)) { line.status = "filled"; line.value = resume.name; }
          } else line.status = f === resumeField ? "needs" : "skipped";
          continue;
        }
        if (f.consent) { line.status = "needs"; continue; }
        if (f.demographic && !demographics) { line.status = "skipped"; continue; }
        const hit = book.find(f);
        if (!hit) continue;
        line.value = hit.value;
        if (hit.suggest) { line.status = "suggest"; continue; }
        line.status = (await write(f, hit.value)) ? "filled" : "needs";
        if (line.status === "filled") line.usedKey = hit.key;
      } catch {
        line.status = "needs";
      }
    }
    return results;
  }

  // ---------------------------------------------------------------- recording

  /**
   * Watches the form and reports each answer the person gives: onAnswer({ key, label, value, kind, demographic }).
   * Typing is reported when the field is left; a choice is reported when it is made. Returns a function that stops it.
   */
  function record(onAnswer, root = document) {
    let lastCombobox = null;
    const report = (f) => {
      if (!f || !f.key || f.kind === "file" || f.consent) return;
      const value = valueOf(f);
      if (value && value.length <= 6000) onAnswer({ key: f.key, label: f.label, value, kind: f.kind, demographic: !!f.demographic });
    };
    const fieldFor = (target) => {
      const box = containerOf(target) || root;
      const near = scan(box.closest("fieldset, [role=group], [role=radiogroup]") || box);
      return near.find((f) => f.el === target || (f.els || []).includes(target)) || near.find((f) => f.el.contains?.(target)) || null;
    };
    const onChange = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.matches("input, textarea, select")) return;
      if (t.getAttribute("role") === "combobox") return;
      report(fieldFor(t));
    };
    const onFocus = (e) => {
      const t = e.target instanceof Element ? e.target.closest("[role=combobox], button[aria-haspopup=listbox]") : null;
      if (t) lastCombobox = t;
    };
    const onClick = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const option = t.closest("[role=option], [class*='select__option' i], [data-automation-id=promptOption]");
      if (option && lastCombobox) {
        const label = labelOf(lastCombobox);
        const value = clean(option.textContent);
        if (label && value && !FORBIDDEN.test(label)) onAnswer({ key: keyFor(label, lastCombobox), label, value, kind: "combobox", demographic: DEMOGRAPHIC.test(label) });
        return;
      }
      const button = t.closest("button");
      if (button && YESNO.test(clean(button.textContent))) setTimeout(() => report(fieldFor(button)), 60);
    };
    root.addEventListener("change", onChange, true);
    root.addEventListener("focusin", onFocus, true);
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("change", onChange, true);
      root.removeEventListener("focusin", onFocus, true);
      root.removeEventListener("click", onClick, true);
    };
  }

  // ---------------------------------------------------------------- the page's job

  /** The job a page shows, from its structured data when it has any, else from its headings. */
  function pageJob() {
    let ld = null;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const list = Array.isArray(data) ? data : data["@graph"] || [data];
        ld = list.find((x) => x && x["@type"] === "JobPosting") || ld;
      } catch { /* not JSON */ }
    }
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") || "";
    const strip = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.innerText || d.textContent || ""; };
    const main = document.querySelector("main, [role=main], article, #content, .content") || document.body;
    const place = ld?.jobLocation && (Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation)?.address;
    return {
      url: location.href,
      title: clean(ld?.title || document.querySelector("h1")?.textContent || meta("og:title") || document.title).slice(0, 200),
      company: clean(ld?.hiringOrganization?.name || meta("og:site_name") || "").slice(0, 120),
      location: clean(place ? [place.addressLocality, place.addressRegion, place.addressCountry?.name || place.addressCountry].filter((x) => typeof x === "string").join(", ") : "").slice(0, 200),
      text: (ld?.description ? strip(ld.description) : main.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 60000),
    };
  }

  /** Whether the page holds an application form: several questions, one of them an email, a name or a resume. */
  function looksLikeApplication(fields) {
    return fields.length >= 3 && fields.some((f) => ["email", "first_name", "last_name", "full_name", "phone"].includes(f.key) || (f.kind === "file" && /resume|\bcv\b/i.test(f.label)));
  }

  globalThis.JobhuntEngine = { scan, fill, record, valueOf, keyFor, labelOf, pick, pageJob, looksLikeApplication, DEMOGRAPHIC, FORBIDDEN };
})();
