import { readFileSync } from 'fs';
import { Pool } from 'pg';

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync('.env', 'utf8');
    const match = env.split(/\n/).find((l) => l.startsWith('DATABASE_URL'));
    if (!match) return null;
    const [, val] = match.split('=');
    return val ? val.trim().replace(/(^\"|\"$|^\'|\'$)/g, '') : null;
  } catch (e) {
    return null;
  }
}

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS job_sources (
  id SERIAL PRIMARY KEY,
  name TEXT,
  url TEXT NOT NULL,
  type TEXT,
  last_run TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS job_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_url TEXT NOT NULL UNIQUE,
  title TEXT,
  company TEXT,
  description TEXT,
  location TEXT,
  requirements TEXT,
  sponsorship_offered TEXT,
  clearance_required BOOLEAN,
  citizenship_required BOOLEAN,
  experience_level TEXT,
  date_posted TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  source_id INTEGER REFERENCES job_sources(id) ON DELETE SET NULL,
  extra JSONB
);

CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  raw_text TEXT,
  parsed JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  job_id UUID REFERENCES job_listings(id) ON DELETE CASCADE,
  score NUMERIC,
  summary TEXT,
  matched_skills JSONB,
  missing_skills JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

(async () => {
  const conn = getDatabaseUrl();
  if (!conn) {
    console.error('DATABASE_URL not set in environment or .env file. Aborting.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: conn });
  try {
    console.log('Connecting to database...');
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query('COMMIT');
    console.log('Schema created or already exists.');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error running schema:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
