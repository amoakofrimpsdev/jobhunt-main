const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function show(s) {
  $("state").className = `state ${s.running ? (s.paired ? "ok" : "warn") : "off"}`;
  $("state-text").textContent = s.running ? (s.paired ? "Connected to Jobhunt" : "Jobhunt is open, not paired yet") : "Jobhunt is not open on this computer";
  $("pair").hidden = !s.running || s.paired;
  $("ready").hidden = !s.paired;
}

send({ type: "status" }).then(show);

$("pair-go").addEventListener("click", async () => {
  const s = await send({ type: "pair", code: $("code").value });
  show(s);
  if (s.running && !s.paired) $("state-text").textContent = "That code was not accepted. Copy it again from Settings.";
});

$("unpair").addEventListener("click", async () => show(await send({ type: "pair", code: "" })));

// Starts the panel on a site that is not in the built-in list. activeTab gives access to this one tab, now, only
// because the person clicked.
$("here").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["engine.js", "view.js", "content.js"] });
  window.close();
});

// Chrome opens its side panel only while a click is being handled, so the window is looked up ahead of time and the
// click itself does nothing but open the panel.
let windowId = null;
chrome.windows.getCurrent((w) => { windowId = w.id; });
$("side").addEventListener("click", () => {
  if (windowId === null) return;
  chrome.sidePanel.open({ windowId }).then(() => window.close(), () => undefined);
});
