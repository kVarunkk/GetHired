import { describe, expect, it } from "vitest";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { google } from "@ai-sdk/google";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { AGENT_MODEL, AGENT_SAFETY_SETTINGS } from "@/helpers/agent/config";
import { buildSystemPrompt, type AgentProfileSummary } from "@/helpers/agent/system-prompt";
import { createChatTools } from "@/helpers/agent/tools";
import { resolveExperience, type ExperienceFilters } from "@/helpers/agent/tools/experience-range";

// Agent chat review 2026-11-20, problem 4 and turns 2, 3 and 6. Calls Gemini
// for real: run with `npm run eval:agent-search` (needs
// GOOGLE_GENERATIVE_AI_API_KEY in .env). Not part of `npm test`. The tools
// are the chat's own schemas with their execute replaced, so nothing reads
// the database: each case checks the first job search the model sends.

const RUNS = 3;

/** The test session's profile (edf8278a). */
const PROFILE: AgentProfileSummary = {
  full_name: "Test User",
  ai_credits: 50,
  desired_roles: ["Frontend Developer", "Fullstack Developer", "AI Engineer", "Product Engineer"],
  preferred_locations: ["Remote", "Bengaluru", "Gurugram", "Hyderabad", "India"],
  min_salary: 1200000,
  max_salary: 2000000,
  salary_currency: "INR",
  experience_years: 1,
  top_skills: ["React", "TypeScript", "Next.js", "Python"],
  job_type: ["Fulltime"],
  visa_sponsorship_required: true,
  work_style_preferences: ["Remote"],
  career_goals_short_term: null,
  career_goals_long_term: null,
  company_size_preference: null,
  filled: true,
};

const SEARCH_TOOLS = ["searchJobs", "findRelevantJobs", "naturalLanguageJobSearch"];

type SearchCall = { tool: string; input: Record<string, unknown> };

/** The chat's tools, recording calls instead of running them. */
function recordingTools(calls: SearchCall[]): ToolSet {
  const tools = createChatTools({
    supabase: {} as SupabaseClient<Database>,
    user: { id: "eval-user" } as User,
    sessionId: "eval",
    surface: "agent",
  });
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input: Record<string, unknown>) => {
          calls.push({ tool: name, input });
          return SEARCH_TOOLS.includes(name) ? { jobs: [], totalCount: 0, nextCursor: null } : { error: "Not available in this eval." };
        },
      },
    ]),
  ) as ToolSet;
}

/** The first job search the model sends for `messages`, with its filters. */
async function firstSearch(messages: ModelMessage[]): Promise<SearchCall | undefined> {
  const calls: SearchCall[] = [];
  await generateText({
    model: google(AGENT_MODEL),
    system: buildSystemPrompt({ profile: PROFILE, memories: [], now: new Date("2026-11-20T20:48:00Z") }),
    messages,
    tools: recordingTools(calls),
    providerOptions: { google: { safetySettings: [...AGENT_SAFETY_SETTINGS] } },
    stopWhen: stepCountIs(3),
  });
  return calls.find((call) => SEARCH_TOOLS.includes(call.tool));
}

/** A search's filters, wherever the tool keeps them. */
const filtersOf = (call: SearchCall) =>
  (call.tool === "findRelevantJobs" ? (call.input.filters as Record<string, unknown> | undefined) ?? {} : call.input);

const lower = (values: unknown) => (Array.isArray(values) ? values.map((v) => String(v).toLowerCase()) : []);

const runs = (messages: ModelMessage[]) => Promise.all(Array.from({ length: RUNS }, () => firstSearch(messages)));

describe("agent job-search evals (review 2026-11-20)", () => {
  // Turn 5: the call had no locations, and results came from Durham, Paris and Rotterdam.
  it("sends every place the user named, Remote included", async () => {
    for (const call of await runs([{ role: "user", content: "Find remote AI engineer jobs in India paying over 15 LPA" }])) {
      expect(call, "no job search").toBeDefined();
      if (call!.tool === "naturalLanguageJobSearch") continue; // the query keeps the user's words
      const locations = lower(filtersOf(call!).locations);
      expect(locations, JSON.stringify(call)).toContain("remote");
      expect(locations, JSON.stringify(call)).toContain("india");
    }
  });

  // Turn 5: the profile's "needs sponsorship" was applied to jobs in India.
  it("doesn't add the profile's visa requirement to a search in the user's own country", async () => {
    for (const call of await runs([{ role: "user", content: "Find remote AI engineer jobs in India paying over 15 LPA" }])) {
      expect(call, "no job search").toBeDefined();
      expect(filtersOf(call!).visaRequirements, JSON.stringify(call)).toBeUndefined();
    }
  });

  // Turn 3: experienceYears 1 became a 1–4 year range after widening.
  it("maps fresher to maxExperience 1", async () => {
    for (const call of await runs([{ role: "user", content: "show some fresher backend roles" }])) {
      expect(call, "no job search").toBeDefined();
      if (call!.tool === "naturalLanguageJobSearch") continue;
      // The range the tool searches: an explicit max wins over experienceYears.
      const range = resolveExperience(filtersOf(call!) as ExperienceFilters, PROFILE.experience_years);
      expect(range.maxExperience, JSON.stringify(call)).toBeLessThanOrEqual(1);
    }
  });

  // Turns 2 and 6, trace 95571a1f: "show more" answered with anyRole.
  it("keeps the user's role for 'show more remote jobs'", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Find remote AI engineer jobs" },
      {
        role: "assistant",
        content: "Here are 3 remote AI engineer jobs: AI Engineer at iion, ML Engineer at Acme, and AI Developer at Nimbus.",
      },
      { role: "user", content: "Show more remote jobs" },
    ];
    for (const call of await runs(messages)) {
      if (!call || call.tool !== "searchJobs") continue; // findRelevantJobs or a page are fine
      expect(call.input.anyRole, JSON.stringify(call)).not.toBe(true);
      expect(lower(call.input.keywords).length, JSON.stringify(call)).toBeGreaterThan(0);
    }
  });
});
