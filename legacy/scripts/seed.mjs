import { Pool } from 'pg';

const getDatabaseUrl = () => process.env.DATABASE_URL;

const sql = `
-- seed job_sources
INSERT INTO job_sources (name, url, type, last_run)
VALUES ('Example Company', 'https://example.com/careers', 'company-site', now())
ON CONFLICT DO NOTHING;

-- seed job_listings
INSERT INTO job_listings (application_url, title, company, description, location, requirements, sponsorship_offered, clearance_required, citizenship_required, experience_level, date_posted, source_id, extra)
SELECT
  'https://example.com/jobs/1',
  'Frontend Engineer',
  'Example Company',
  'Build and maintain web apps in React/Next.js. Experience with Tailwind is a plus.',
  'Remote (US)',
  'React, Next.js, Tailwind, TypeScript',
  'unknown',
  FALSE,
  FALSE,
  'Mid',
  now() - interval '3 days',
  js.id,
  jsonb_build_object('raw', 'sample')
FROM (SELECT id FROM job_sources LIMIT 1) js
ON CONFLICT (application_url) DO UPDATE SET
  title = EXCLUDED.title,
  company = EXCLUDED.company,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  requirements = EXCLUDED.requirements,
  scraped_at = now();

-- seed resume
INSERT INTO resumes (user_id, raw_text, parsed)
VALUES (
  'anonymous',
  'Resume raw text here: frontend, react, next.js, tailwind, typescript',
  jsonb_build_object(
    'parsed_skills', jsonb_build_array('React','Next.js','TypeScript','Tailwind'),
    'parsed_experience', jsonb_build_array(jsonb_build_object('company','Acme','role','Frontend Engineer','years',2)),
    'parsed_education', jsonb_build_array(jsonb_build_object('school','State U','degree','BS Computer Science'))
  )
);

-- seed match
INSERT INTO job_matches (user_id, job_id, score, summary, matched_skills, missing_skills)
VALUES (
  'anonymous',
  (SELECT id FROM job_listings LIMIT 1),
  92,
  'Good match: React/Next.js/TypeScript listed in resume; missing advanced GraphQL skill (optional).',
  jsonb_build_array('React','Next.js','TypeScript'),
  jsonb_build_array('GraphQL')
)
ON CONFLICT (user_id, job_id) DO UPDATE SET score = EXCLUDED.score;
`;

(async () => {
  const conn = getDatabaseUrl();
  if (!conn) {
    console.error('DATABASE_URL missing. Set it in the environment (export DATABASE_URL=...)');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: conn });
  try {
    console.log('Connecting to database...');
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error seeding DB:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
