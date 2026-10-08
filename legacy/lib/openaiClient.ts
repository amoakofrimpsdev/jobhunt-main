import OpenAI from "openai";

function makeMockClient() {
  // Simple heuristic-based mock that returns JSON content strings for the two main prompts used:
  // - Resume parser prompt (contains 'Parse the resume text')
  // - Job matcher prompt (contains 'You are an AI job matcher')
  const knownSkills = ['React','Next.js','Nextjs','TypeScript','JavaScript','Tailwind','GraphQL','Node.js','Node','Python','Django','AWS','Docker','Kubernetes'];

  return {
    chat: {
      completions: {
        create: async ({ messages }: any) => {
          const user = Array.isArray(messages) ? messages.find((m: any) => m.role === 'user') : null;
          const content: string = user?.content ?? '';

          if (content.includes('Parse the resume text')) {
            // crude skill extraction
            const skillsFound = knownSkills.filter(s => new RegExp(`\\b${s.replace('.', '\\.')}(?:\\b|$)`, 'i').test(content)).map(s => s === 'Nextjs' ? 'Next.js' : s);
            const parsed = {
              parsed_skills: Array.from(new Set(skillsFound)).slice(0, 30),
              parsed_experience: [],
              parsed_education: [],
            };
            return { choices: [{ message: { content: JSON.stringify(parsed) } }] };
          }

          if (content.includes('You are an AI job matcher')) {
            // try to extract job requirements and resume skills from the prompt
            // find 'Requirements:' line and resume Skills
            const reqMatch = content.match(/Requirements:\s*([\s\S]*?)\n\n/);
            const reqs = (reqMatch ? reqMatch[1] : '').split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean);
            const resumeSkillsMatch = content.match(/Skills:\s*([\s\S]*?)\nExperience:/);
            const resumeSkills = resumeSkillsMatch ? resumeSkillsMatch[1].split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean) : [];

            const matched = reqs.filter((r: string) => resumeSkills.some((rs: string) => new RegExp(r.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'), 'i').test(rs)));
            const missing = reqs.filter((r: string) => !matched.includes(r)).slice(0,10);
            const score = Math.min(100, Math.round((matched.length / Math.max(1, reqs.length)) * 100));

            const result = {
              score: Number.isFinite(score) ? score : 0,
              summary: `Matched ${matched.length} of ${reqs.length} listed requirements.`,
              matched_skills: matched,
              missing_skills: missing,
            };

            return { choices: [{ message: { content: JSON.stringify(result) } }] };
          }

          // fallback: return minimal valid JSON
          return { choices: [{ message: { content: JSON.stringify({ parsed_skills: [], parsed_experience: [], parsed_education: [] }) } }] };
        }
      }
    }
  };
}

export function createOpenAIClient() {
  const mock = process.env.MOCK_LLM === 'true';
  if (mock) {
    return makeMockClient();
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return makeMockClient();
  }
  return new OpenAI({ apiKey: openaiKey });
}
