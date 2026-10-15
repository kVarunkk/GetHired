import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { buildSystemPrompt, type AgentProfileSummary } from "../system-prompt";
import { createAgentTools } from "../tools";
import { agentToolApproval } from "../approval";
import { inputJsonSchema, toolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";

// RA-TEST-001 / RA-CON-002: the applicant agent's prompt, tools and approval
// decisions, snapshotted before the role layer was introduced. The snapshot
// must never change because of recruiter work.

const NOW = new Date("2026-10-11T18:30:00.000Z");

const PROFILE: AgentProfileSummary = {
  full_name: "Ada Lovelace",
  ai_credits: 12,
  desired_roles: ["Frontend Engineer"],
  preferred_locations: ["Remote", "Bengaluru"],
  min_salary: 1500000,
  max_salary: 2500000,
  salary_currency: "INR",
  experience_years: 4,
  top_skills: ["React", "TypeScript"],
  job_type: ["Fulltime"],
  visa_sponsorship_required: false,
  work_style_preferences: ["Remote"],
  career_goals_short_term: "Lead a small frontend team",
  career_goals_long_term: null,
  company_size_preference: null,
  filled: true,
};

const MEMORIES = [
  { id: "a1b2c3d4-0000-4000-8000-000000000001", category: "preference", content: "Avoid crypto companies" },
];

const user = (text: string): ModelMessage => ({ role: "user", content: text });
const ran = (toolName: string, toolCallId: string): ModelMessage[] => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input: {} }] },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId, toolName, output: { type: "json", value: {} } }],
  },
];

/** Builds the applicant surface the snapshot pins, from any implementation. */
async function applicantSurface({
  prompt,
  tools,
  approval,
}: {
  prompt: typeof buildSystemPrompt;
  tools: typeof createAgentTools;
  approval: typeof agentToolApproval;
}) {
  const toolSet = tools(toolContext(createSupabaseMock().client));
  const names = Object.keys(toolSet).sort();

  const schemas: Record<string, unknown> = {};
  for (const name of names) {
    const tool = toolSet[name as keyof typeof toolSet];
    schemas[name] = { description: tool.description, input: await inputJsonSchema(tool) };
  }

  const turns: Record<string, ModelMessage[]> = {
    plain: [user("hi")],
    afterUntrustedRead: [user("x"), ...ran("getJobDetails", "c1")],
    afterTwoCreditCalls: [
      user("x"),
      ...ran("naturalLanguageJobSearch", "c1"),
      ...ran("startResumeReview", "c2"),
    ],
  };
  const decisions = Object.fromEntries(
    Object.entries(turns).map(([turn, messages]) => [
      turn,
      Object.fromEntries(
        [...names, "unknownTool"].map((name) => [
          name,
          approval({ toolCall: { toolName: name, toolCallId: "current" }, messages }),
        ]),
      ),
    ]),
  );

  const prompts = {
    filled: prompt({ profile: PROFILE, memories: MEMORIES, now: NOW, summary: "Talked about React jobs." }),
    unfilled: prompt({ profile: { ...PROFILE, filled: false }, memories: [], now: NOW }),
    none: prompt({ profile: null, memories: [], now: NOW }),
  };

  return { names, schemas, decisions, prompts };
}

describe("applicant agent baseline (RA-TEST-001)", () => {
  it("matches the snapshot taken before the role layer", async () => {
    const surface = await applicantSurface({
      prompt: buildSystemPrompt,
      tools: createAgentTools,
      approval: agentToolApproval,
    });
    expect(surface).toMatchSnapshot();
  });
});
