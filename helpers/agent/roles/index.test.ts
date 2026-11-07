import { describe, expect, it, vi } from "vitest";
import { AGENT_ROLES } from "./index";
import {
  AGENT_CONTENT_FILTER_MESSAGE,
  AGENT_DAILY_MESSAGE_CAP,
} from "../config";
import { buildSystemPrompt } from "../system-prompt";
import { createChatTools } from "../tools";
import { agentToolApproval } from "../approval";
import { recruiterToolContext, toolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-11T18:30:00.000Z");

describe("AGENT_ROLES.applicant (RA-TEST-001)", () => {
  const role = AGENT_ROLES.applicant;

  it("keeps the applicant agent's settings", () => {
    expect(role.id).toBe("applicant");
    expect(role.dailyCap).toBe(AGENT_DAILY_MESSAGE_CAP);
    expect(role.telemetryPrefix).toBe("agent");
    expect(role.contentFilterMessage).toBe(AGENT_CONTENT_FILTER_MESSAGE);
    expect(role.toolApproval).toBe(agentToolApproval);
  });

  it("builds the same tools as before", () => {
    const supabase = createSupabaseMock().client;
    const tools = role.createTools({ supabase, user: toolContext(supabase).user, sessionId: "s1", company: null });
    expect(Object.keys(tools)).toEqual(Object.keys(createChatTools(toolContext(supabase))));
  });

  it("loads the profile and builds the same prompt as before", async () => {
    const supabase = createSupabaseMock();
    const profile = { full_name: "Ada", ai_credits: 3, filled: true };
    supabase.queue("user_info", { data: profile, error: null });

    const build = await role.loadPrompt({
      supabase: supabase.client,
      user: mockUser({ id: "u1" }),
      company: null,
    });
    const input = { memories: [], now: NOW, summary: "Earlier." };

    expect(build({ ...input, toolNames: ["searchJobs"] })).toBe(
      buildSystemPrompt({ profile: profile as never, ...input }),
    );
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", "u1"],
    });
  });
});

describe("feedbackMilestones (AF-REQ-011)", () => {
  it("names only the applicant's own tools", () => {
    const supabase = createSupabaseMock().client;
    const tools = Object.keys(
      AGENT_ROLES.applicant.createTools({ supabase, user: toolContext(supabase).user, sessionId: "s1", company: null }),
    );
    expect(AGENT_ROLES.applicant.feedbackMilestones).toEqual([
      "submitApplication",
      "improveResume",
      "completeOnboarding",
      "updateMyPreferences",
    ]);
    for (const name of AGENT_ROLES.applicant.feedbackMilestones ?? []) expect(tools).toContain(name);
  });

  it("names only the company's own tools", () => {
    const ctx = recruiterToolContext(createSupabaseMock().client);
    const tools = Object.keys(AGENT_ROLES.company.createTools({ ...ctx, sessionId: "s1" }));
    expect(AGENT_ROLES.company.feedbackMilestones?.length).toBeGreaterThan(0);
    for (const name of AGENT_ROLES.company.feedbackMilestones ?? []) expect(tools).toContain(name);
  });
});
