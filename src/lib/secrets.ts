// Where API keys live. Never in the database, never sent to the browser, and only ever sent to the provider they
// belong to.
//   macOS:   the Keychain, under the service name "Jobhunt", through the system's own `security` tool.
//   Windows: a file in the data folder holding each key encrypted with Windows Data Protection (DPAPI) for the
//            signed-in user, through Windows PowerShell: another account, or a copy of the file on another
//            computer, cannot read it.
//   Others:  a file in the data folder only this user can read.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";

const SERVICE = "Jobhunt";
// JOBHUNT_KEYS_FILE keeps the keys in the data folder's file on any system: the tests use it so that they never
// touch the Keychain of the computer running them.
const mac = process.platform === "darwin" && !process.env.JOBHUNT_KEYS_FILE;
const windows = process.platform === "win32" && !process.env.JOBHUNT_KEYS_FILE;
const keysFile = () => join(dataDir(), "keys.json");
/** Keys already read this run: on Windows each read would otherwise start PowerShell. */
const cache = new Map<string, string | null>();

function readFile(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(keysFile(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeFile(keys: Record<string, string>): void {
  writeFileSync(keysFile(), JSON.stringify(keys), { mode: 0o600 });
  if (!windows) chmodSync(keysFile(), 0o600);
}

/** Runs a Windows PowerShell script with `input` on its standard input and returns what it prints. */
function powershell(script: string, input: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], windowsHide: true, timeout: 20_000 }).trim();
}

const DPAPI = "Add-Type -AssemblyName System.Security; $s = [Console]::In.ReadToEnd().Trim();";
const protect = (value: string) =>
  `dpapi:${powershell(`${DPAPI} [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s), $null, 'CurrentUser'))`, value)}`;
const unprotect = (stored: string) =>
  powershell(`${DPAPI} [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s), $null, 'CurrentUser'))`, stored.slice("dpapi:".length));

export function getSecret(name: string): string | null {
  if (cache.has(name)) return cache.get(name) ?? null;
  let value: string | null = null;
  if (mac) {
    try {
      value = execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      value = null;
    }
  } else {
    const stored = readFile()[name] ?? null;
    if (stored?.startsWith("dpapi:")) {
      try { value = unprotect(stored) || null; } catch { value = null; }
    } else {
      value = stored;
    }
  }
  cache.set(name, value);
  return value;
}

export function setSecret(name: string, value: string | null): void {
  cache.delete(name);
  if (mac) {
    try { execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", name], { stdio: "ignore" }); } catch { /* none saved */ }
    if (value) execFileSync("/usr/bin/security", ["add-generic-password", "-s", SERVICE, "-a", name, "-w", value, "-U"], { stdio: "ignore" });
    return;
  }
  const keys = readFile();
  if (value) {
    if (windows) {
      try {
        keys[name] = protect(value);
      } catch {
        throw new Error("Windows could not encrypt the key (Windows PowerShell did not answer), so it was not saved.");
      }
    } else {
      keys[name] = value;
    }
  } else {
    delete keys[name];
  }
  if (value || existsSync(keysFile())) writeFile(keys);
}

export function hasSecret(name: string): boolean {
  return getSecret(name) !== null;
}

/** How the keys are kept, in words for the Settings page. */
export function keyStoreName(): string {
  return mac ? "the macOS Keychain" : windows ? "a file encrypted with your Windows sign-in" : "a file only your account can read";
}
