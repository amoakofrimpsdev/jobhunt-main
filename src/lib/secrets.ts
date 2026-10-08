// Where API keys live: the macOS Keychain, under the service name "Jobhunt". A key is written and read by the
// system's own `security` tool, never stored in the database, never sent to the browser, and only ever sent to the
// provider it belongs to. On other systems the key goes in a file only this user can read.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";

const SERVICE = "Jobhunt";
const mac = process.platform === "darwin";
const fallbackFile = () => join(dataDir(), "keys.json");

function readFallback(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(fallbackFile(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeFallback(keys: Record<string, string>): void {
  writeFileSync(fallbackFile(), JSON.stringify(keys), { mode: 0o600 });
  chmodSync(fallbackFile(), 0o600);
}

export function getSecret(name: string): string | null {
  if (mac) {
    try {
      return execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      return null;
    }
  }
  return readFallback()[name] ?? null;
}

export function setSecret(name: string, value: string | null): void {
  if (mac) {
    try { execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", name], { stdio: "ignore" }); } catch { /* none saved */ }
    if (value) execFileSync("/usr/bin/security", ["add-generic-password", "-s", SERVICE, "-a", name, "-w", value, "-U"], { stdio: "ignore" });
    return;
  }
  const keys = readFallback();
  if (value) keys[name] = value; else delete keys[name];
  if (value || existsSync(fallbackFile())) writeFallback(keys);
}

export function hasSecret(name: string): boolean {
  return getSecret(name) !== null;
}
