// Jobhunt.exe on Windows: Node's own runtime with this file built in (a Node single executable application). It
// starts the app's server from the "app" folder beside it, opens Jobhunt in the default browser, and keeps a small
// console window: closing that window quits Jobhunt. Data lives in %LOCALAPPDATA%\Jobhunt.
//
// Given the path of a .cjs file (Claude Desktop does this for the Jobhunt connector), it runs that file instead,
// as plain Node would.
const { createRequire } = require("node:module");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const here = path.dirname(process.execPath);
const appDir = path.join(here, "app");

// The Chrome extension looks for the app on these ports, in this order. (JOBHUNT_PORTS is for testing.)
const PORTS = process.env.JOBHUNT_PORTS ? process.env.JOBHUNT_PORTS.split(",").map(Number) : [47600, 47601, 47602, 47603];

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/ext/ping", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body).app === "jobhunt"); } catch { resolve(false); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function free(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

function openBrowser(url) {
  // rundll32 hands the address to the default browser without going through cmd.
  execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], () => undefined);
}

async function main() {
  process.title = "Jobhunt";
  if (!fs.existsSync(path.join(appDir, "server.js"))) throw new Error(`the app folder is missing next to Jobhunt.exe (${appDir}). Keep Jobhunt.exe and the app folder together.`);
  // Already running: show it instead of starting a second copy.
  for (const port of PORTS) {
    if (await ping(port)) {
      console.log(`Jobhunt is already running at http://127.0.0.1:${port}. Opening it.`);
      openBrowser(`http://127.0.0.1:${port}`);
      setTimeout(() => process.exit(0), 1500);
      return;
    }
  }
  let port = null;
  for (const p of PORTS) if (await free(p)) { port = p; break; }
  if (!port) throw new Error("ports 47600 to 47603 are all in use by other programs.");

  const data = path.join(process.env.LOCALAPPDATA || path.join(require("node:os").homedir(), "AppData", "Local"), "Jobhunt");
  fs.mkdirSync(data, { recursive: true });
  process.env.JOBHUNT_DATA_DIR = data;
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "production";

  console.log("Jobhunt");
  console.log("-------");
  // A database that needs slow, one-time upgrade steps gets them first, with a page in the browser saying so.
  const upgrade = createRequire(path.join(appDir, "upgrade.cjs"))(path.join(appDir, "upgrade.cjs"));
  let shown = false;
  try {
    if (upgrade.pendingSteps(path.join(data, "jobhunt.db")).length) {
      const running = upgrade.upgradeBeforeStart({ dataDir: data, port, workerFile: path.join(appDir, "upgrade.cjs") });
      await new Promise((r) => setTimeout(r, 400));
      openBrowser(`http://127.0.0.1:${port}`);
      shown = true;
      await running;
    }
  } catch (e) {
    console.error(`Database update failed: ${e && e.message ? e.message : e}`);
  }
  console.log(`Starting at http://127.0.0.1:${port} ...`);
  createRequire(path.join(appDir, "server.js"))(path.join(appDir, "server.js"));

  for (let i = 0; i < 120; i++) {
    if (await ping(port)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const url = `http://127.0.0.1:${port}`;
  // The update page reloads itself into the app once it is up.
  if (!shown) openBrowser(url);
  console.log(`\nJobhunt is open in your browser: ${url}`);
  console.log("Keep this window open while you use Jobhunt. Close it to quit.");
  console.log(`Your data: ${data}`);
}

const script = process.argv.findIndex((a, i) => i > 0 && /\.c?js$/i.test(a) && a !== process.execPath);
if (script > 0) {
  const file = path.resolve(process.argv[script]);
  process.argv = [process.execPath, file, ...process.argv.slice(script + 1)];
  createRequire(file)(file);
} else {
  main().catch((e) => {
    console.error(`\nJobhunt could not start: ${e && e.message ? e.message : e}`);
    console.error("Press Enter to close this window.");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  });
}
