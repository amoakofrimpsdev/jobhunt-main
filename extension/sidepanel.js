// Jobhunt in Chrome's side panel: the full panel, docked beside the page so it never covers the form. It holds no
// state of its own. It shows what the content script on the tab in front reports, and passes back what the person
// clicks; the content script does the work on the page.
const V = globalThis.JobhuntView;
const mount = document.getElementById("mount");
document.getElementById("mark").innerHTML = V.MARK;
document.getElementById("view-css").textContent = V.CSS;

let tabId = null;
let snap = null;
let answered = false;

function render() {
  // What is being typed into the pairing box survives a redraw.
  const typed = mount.querySelector("#code")?.value;
  if (snap) mount.innerHTML = V.body(snap);
  else if (!answered) mount.innerHTML = `<p>Looking at this page…</p>`;
  else mount.innerHTML = `<div class="idle"><b>Jobhunt is not on this page.</b><p>Open a job application and it appears here by itself. On a site Jobhunt does not recognise, click the Jobhunt icon in Chrome's toolbar and choose “Use on this page”.</p></div>`;
  const box = mount.querySelector("#code");
  if (box && typed) box.value = typed;
}

/** Asks the tab in front for its state. A tab without the content script simply does not answer. */
async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  snap = null;
  answered = false;
  render();
  if (tabId === null) { answered = true; return render(); }
  const asked = tabId;
  let got = null;
  try { got = await chrome.tabs.sendMessage(asked, { type: "jh:get" }); } catch { /* no content script there */ }
  if (asked !== tabId) return;
  // An update may have arrived while the question was out; it is newer than this answer.
  if (!snap) snap = got || null;
  answered = true;
  render();
}

V.wire(mount, (action, payload) => {
  if (tabId === null || !snap) return;
  chrome.tabs.sendMessage(tabId, { type: "jh:act", frame: snap.frame, action, payload }).catch(() => refresh());
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "jh:update" || sender.tab?.id !== tabId) return;
  // Stay with the frame already shown, unless there is none yet or another frame turns out to hold the form.
  if (!snap || msg.snap.frame === snap.frame || (msg.snap.isForm && !snap.isForm)) { snap = msg.snap; answered = true; render(); }
});

let again = null;
const soon = () => { clearTimeout(again); again = setTimeout(refresh, 500); };
chrome.tabs.onActivated.addListener(soon);
chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && change.status === "complete") soon(); });
chrome.windows.onFocusChanged.addListener(soon);
refresh();
