#!/usr/bin/env node
// Jobhunt for Claude Desktop: a Model Context Protocol server over stdio. Claude Desktop starts this file; it passes
// each tool call to the RUNNING Jobhunt app on this computer (127.0.0.1, the port in run.json in the data folder) and
// hands back the answer. Nothing goes anywhere else, and the AI work happens in Claude Desktop on the person's own
// Claude plan. Node built-ins only, so the app's own copy of Node can run it with nothing installed.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const PROTOCOL = "2025-06-18";
// argv[2] is the data folder: the app writes it into Claude Desktop's config when the connector is added.
const dataDir = process.argv[2] || process.env.JOBHUNT_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "com.danielfrimpong.jobhunt");
const tools = JSON.parse(fs.readFileSync(path.join(__dirname, "tools.json"), "utf8"));

async function call(tool, args) {
  let run;
  try {
    run = JSON.parse(fs.readFileSync(path.join(dataDir, "run.json"), "utf8"));
  } catch {
    throw new Error("Jobhunt is not running. Open Jobhunt on this Mac, then ask again.");
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${run.port}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-jobhunt-token": run.token },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Jobhunt is not answering. Open Jobhunt on this Mac, then ask again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Jobhunt answered ${res.status}.`);
  return String(body.text ?? "");
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function handle(msg) {
  const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "jobhunt", version: "0.3.0" },
        instructions: "Jobhunt is the person's local job-search app. Search their jobs, read postings, their profile and resumes, and save what you write for a job back with save_document. Use only facts from their resume. Jobhunt must be open on the Mac.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools });
    case "tools/call": {
      try {
        return reply({ content: [{ type: "text", text: await call(msg.params?.name, msg.params?.arguments ?? {}) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      // Notifications carry no id and get no answer; an unknown request gets the standard error.
      if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  void handle(msg);
});
