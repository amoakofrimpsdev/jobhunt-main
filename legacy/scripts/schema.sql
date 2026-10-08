-- JobHunt database schema

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
