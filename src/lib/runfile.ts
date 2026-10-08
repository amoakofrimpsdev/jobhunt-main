// Where the running server can be found: its port and a token made for this launch, written to run.json in the data
// folder for the Claude Desktop connector. Kept apart from everything else so that starting the server loads nothing
// but this file.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Run = { port: number; token: string; pid: number };
const g = globalThis as unknown as { __jobhuntRun?: Run };
const dataDir = () => process.env.JOBHUNT_DATA_DIR ?? join(process.cwd(), ".data");

/** Written at start, readable by this user only. */
export function writeRunFile(): void {
  const port = Number(process.env.PORT) || 3000;
  g.__jobhuntRun = { port, token: randomBytes(24).toString("hex"), pid: process.pid };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(join(dataDir(), "run.json"), JSON.stringify(g.__jobhuntRun), { mode: 0o600 });
}

export function connectorTokenOk(token: string | null): boolean {
  const mine = g.__jobhuntRun?.token;
  if (!mine || !token || token.length !== mine.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(mine));
}
