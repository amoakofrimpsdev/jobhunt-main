import { readFileSync } from "fs";
import { resolve } from "path";
import { Pool } from "pg";

function normalizeConnectionString(value: string): string {
  const match = value.match(/^(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@(.+)$/);
  if (!match) {
    return value;
  }

  const [, prefix, username, password, suffix] = match;
  return `${prefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${suffix}`;
}

function loadDatabaseUrl(): string | undefined {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const contents = readFileSync(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      if (key !== "DATABASE_URL") continue;
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    // ignore and fall back below
  }

  const fromProcessEnv = process.env.DATABASE_URL;
  if (fromProcessEnv && fromProcessEnv.trim()) {
    return fromProcessEnv.trim();
  }

  return undefined;
}

const connectionString = loadDatabaseUrl();
if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable. Put it in .env or in the process environment.");
}

const pool = new Pool({ connectionString: normalizeConnectionString(connectionString) });

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}
