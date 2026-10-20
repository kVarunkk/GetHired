import { describe, expect, it } from "vitest";
import { AGENT_ROLES } from "./index";
import {
  AGENT_CONTENT_FILTER_MESSAGE,
  AGENT_DAILY_MESSAGE_CAP,
} from "../config";
import { buildSystemPrompt } from "../system-prompt";
import { createAgentTools } from "../tools";
import { agentToolApproval } from "../approval";
import { toolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";

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
    const tools = role.createTools({ ...toolContext(supabase), company: null });
    expect(Object.keys(tools)).toEqual(Object.keys(createAgentTools(toolContext(supabase))));
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
