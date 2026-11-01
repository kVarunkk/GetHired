/**
 * The MCP tool catalog (MCP TASK-040, spec §4.4): every tool is there, its
 * flags come from the agent's approval policy, and its annotations agree with
 * them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTools, type AgentTools } from "@/helpers/agent/tools";
import { APPLICANT_APPROVAL_POLICY } from "@/helpers/agent/approval";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { getResumeDetails } from "@/helpers/resumes/get-resume-details";
import { listResumeReviews } from "@/helpers/resume-review/list-resume-reviews";
import { asSchema } from "ai";
import {
  MCP_EXCLUDED_AGENT_TOOLS,
  MCP_TOOLS,
  bindMcpTool,
  mcpToolFlags,
  type McpToolDef,
} from "./tools";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { toMcpSchema } from "./schema";

vi.mock("@/helpers/jobs/search-jobs", () => ({ searchJobs: vi.fn() }));
vi.mock("@/helpers/resumes/get-resume-details", () => ({ getResumeDetails: vi.fn() }));
vi.mock("@/helpers/resume-review/list-resume-reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume-review/list-resume-reviews")>()),
  listResumeReviews: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const LEGACY_NAMES = [
  "search_jobs",
  "get_saved_jobs",
  "get_applied_jobs",
  "get_relevant_jobs",
  "get_similar_jobs",
  "get_job_details",
  "favorite_job",
  "get_my_profile",
  "get_resumes",
  "get_resume_details",
  "get_resume_reviews",
  "get_resume_review_details",
];

const NEW_NAMES = [
  "natural_language_job_search",
  "list_applications",
  "update_application_status",
  "get_application_form",
  "submit_application",
  "set_primary_resume",
  "start_resume_review",
  "pick_resume_for_job",
  "update_my_preferences",
  "complete_onboarding",
  "list_interviews",
  "get_interview_analysis",
  "create_interview",
  "list_screening_interviews",
];

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

let supabase: SupabaseMock;
let ctx: AgentToolContext;
let tools: AgentTools;

beforeEach(() => {
  supabase = createSupabaseMock();
  ctx = toolContext(supabase.client, { sessionId: null, surface: "mcp" });
  tools = createAgentTools(ctx);
});

const def = (name: string) => MCP_TOOLS.find((tool) => tool.name === name)!;
const bind = (name: string) => bindMcpTool(def(name), ctx, tools, APPLICANT_APPROVAL_POLICY);
const properties = async (name: string) =>
  Object.keys(
    ((await asSchema(bind(name).inputSchema).jsonSchema) as { properties?: object }).properties ?? {},
  );

describe("MCP_TOOLS", () => {
  it("has exactly the spec's tools, each once", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...LEGACY_NAMES, ...NEW_NAMES].sort());
  });

  it("uses snake_case names and gives every tool a title and a description", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(bind(tool.name).description.length).toBeGreaterThan(20);
    }
  });

  it("covers every applicant agent tool or excludes it with a reason (TASK-072)", () => {
    const covered = new Set(MCP_TOOLS.flatMap((tool) => tool.agentTools));
    for (const name of Object.keys(tools)) {
      const reason = MCP_EXCLUDED_AGENT_TOOLS[name as keyof AgentTools];
      expect(covered.has(name as keyof AgentTools) !== Boolean(reason), name).toBe(true);
    }
    expect(Object.keys(MCP_EXCLUDED_AGENT_TOOLS).sort()).toEqual([
      "deleteMemory",
      "requestResumeUpload",
      "saveMemory",
    ]);
  });

  it("covers every alwaysAsk and credit tool of the agent, or excludes it", () => {
    const covered = new Set<string>(MCP_TOOLS.flatMap((tool) => tool.agentTools));
    for (const name of [...APPLICANT_APPROVAL_POLICY.alwaysAsk, ...APPLICANT_APPROVAL_POLICY.creditTools]) {
      expect(covered.has(name) || name in MCP_EXCLUDED_AGENT_TOOLS, name).toBe(true);
    }
  });

  it("takes the credit and confirm flags from the agent's approval policy", () => {
    const flagged = (flag: "credit" | "confirm") =>
      MCP_TOOLS.filter((tool) => mcpToolFlags(tool, APPLICANT_APPROVAL_POLICY)[flag])
        .map((tool) => tool.name)
        .sort();

    expect(flagged("confirm")).toEqual(
      ["complete_onboarding", "start_resume_review", "submit_application", "update_my_preferences"].sort(),
    );
    expect(flagged("credit")).toEqual(
      ["natural_language_job_search", "pick_resume_for_job", "start_resume_review", "submit_application"].sort(),
    );
  });

  it("gives every confirm tool, and only those, a preview and a confirmation_token input", () => {
    for (const tool of MCP_TOOLS) {
      const { confirm } = mcpToolFlags(tool, APPLICANT_APPROVAL_POLICY);
      expect(Boolean(tool.preview), tool.name).toBe(confirm);
      const json = toMcpSchema(bind(tool.name).inputSchema, { confirmationToken: confirm })[
        "~standard"
      ].jsonSchema.input({ target: "draft-2020-12" }) as { properties?: Record<string, unknown> };
      expect(Boolean(json.properties?.confirmation_token), tool.name).toBe(confirm);
    }
  });

  it("says in the description which tools cost credits or ask the user", () => {
    for (const tool of MCP_TOOLS) {
      const { credit, confirm } = mcpToolFlags(tool, APPLICANT_APPROVAL_POLICY);
      const { description } = bind(tool.name);
      if (credit) expect(description, tool.name).toMatch(/credit/i);
      if (confirm) expect(description, tool.name).toMatch(/asks the user to confirm/);
    }
  });

  it("never names an agent tool in a description, since MCP clients only know the snake_case names", () => {
    const agentNames = Object.keys(tools);
    for (const tool of MCP_TOOLS) {
      const { description } = bind(tool.name);
      for (const name of agentNames) {
        expect(description, `${tool.name} mentions ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });

  describe("annotations", () => {
    const all = () => MCP_TOOLS.map((tool) => [tool.name, tool] as [string, McpToolDef]);

    it.each(all())("%s declares readOnlyHint and openWorldHint", (_name, tool) => {
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations.openWorldHint).toBe("boolean");
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint).toBeUndefined();
        expect(tool.annotations.idempotentHint).toBeUndefined();
      } else {
        expect(typeof tool.annotations.destructiveHint).toBe("boolean");
        expect(typeof tool.annotations.idempotentHint).toBe("boolean");
      }
    });

    it("never marks a confirm tool read-only", () => {
      for (const tool of MCP_TOOLS.filter((t) => mcpToolFlags(t, APPLICANT_APPROVAL_POLICY).confirm)) {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
      }
    });

    it("marks only the read-only searches among credit tools read-only", () => {
      const readOnlyCredit = MCP_TOOLS.filter(
        (t) => mcpToolFlags(t, APPLICANT_APPROVAL_POLICY).credit && t.annotations.readOnlyHint,
      ).map((t) => t.name);
      expect(readOnlyCredit.sort()).toEqual(["natural_language_job_search", "pick_resume_for_job"]);
    });

    it("matches the spec's hints for the writes", () => {
      const hints = (name: string) => def(name).annotations;
      expect(hints("submit_application")).toMatchObject({ destructiveHint: true, openWorldHint: true });
      expect(hints("favorite_job")).toMatchObject({ destructiveHint: false, idempotentHint: true });
      expect(hints("update_my_preferences")).toMatchObject({ destructiveHint: true, idempotentHint: true });
      expect(hints("complete_onboarding")).toMatchObject({ destructiveHint: true });
      expect(hints("start_resume_review")).toMatchObject({ destructiveHint: false });
      expect(hints("natural_language_job_search")).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    });
  });

  describe("one implementation (TASK-044)", () => {
    const direct = MCP_TOOLS.filter((tool) => !tool.custom).map(
      (tool) => [tool.name, tool.agentTools[0]] as const,
    );

    it("runs every interview tool and every legacy tool without a custom body through its agent tool", () => {
      const names = direct.map(([name]) => name);
      for (const name of [...LEGACY_NAMES.filter((n) => !def(n).custom), ...NEW_NAMES.filter((n) => n.includes("interview"))]) {
        expect(names, name).toContain(name);
      }
    });

    it.each(direct)("%s returns exactly what %s returns for the same input", async (name, agentName) => {
      const output = { from: agentName };
      const execute = vi.fn().mockResolvedValue(output);
      (tools[agentName] as { execute: unknown }).execute = execute;
      const input = { probe: name };

      expect(await bind(name).run(input)).toBe(output);
      expect(execute).toHaveBeenCalledWith(input, expect.objectContaining({ messages: [] }));
    });
  });

  describe("adapted tools", () => {
    it("runs an agent tool as is, with its own schema", async () => {
      const bound = bind("get_job_details");
      expect(bound.inputSchema).toBe(tools.getJobDetails.inputSchema);
      expect(await properties("search_jobs")).toContain("keywords");
    });

    it("get_applied_jobs searches the applied tab and exposes no tab", async () => {
      vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null } as never);

      expect(await properties("get_applied_jobs")).toEqual(["limit"]);
      const result = await bind("get_applied_jobs").run({ limit: 5 });

      expect(searchJobs).toHaveBeenCalledWith(supabase.client, ctx.user, { tab: "applied", limit: 5 });
      expect(result).toEqual({ jobs: [], totalCount: 0, nextCursor: null });
    });

    it("favorite_job saves or removes by action", async () => {
      expect((await properties("favorite_job")).sort()).toEqual(["action", "jobId"]);

      supabase.queue("user_favorites", { data: null, error: null });
      supabase.queue("user_favorites", { data: null, error: null });
      expect(await bind("favorite_job").run({ jobId: JOB_ID, action: "save" })).toEqual({
        jobId: JOB_ID,
        saved: true,
      });

      supabase.queue("user_favorites", { data: null, error: null });
      expect(await bind("favorite_job").run({ jobId: JOB_ID, action: "unsave" })).toEqual({
        jobId: JOB_ID,
        saved: false,
      });
    });

    it("get_resume_details reads the user's resume through the shared helper", async () => {
      vi.mocked(getResumeDetails).mockResolvedValueOnce({ id: RESUME_ID, name: "CV" } as never);
      expect(await bind("get_resume_details").run({ resumeId: RESUME_ID })).toEqual({
        resume: { id: RESUME_ID, name: "CV" },
      });
      expect(getResumeDetails).toHaveBeenCalledWith(supabase.client, ctx.user, RESUME_ID);

      vi.mocked(getResumeDetails).mockResolvedValueOnce(null);
      expect(await bind("get_resume_details").run({ resumeId: RESUME_ID })).toEqual({
        error: "Resume not found.",
      });
    });

    it("get_resume_reviews lists through the shared helper", async () => {
      vi.mocked(listResumeReviews).mockResolvedValueOnce([{ id: "r1" }] as never);

      expect(await bind("get_resume_reviews").run({ limit: 3 })).toEqual({ reviews: [{ id: "r1" }] });
      expect(listResumeReviews).toHaveBeenCalledWith(supabase.client, ctx.user, { limit: 3 });
    });

    it("turns an unexpected error in an adapted tool into a generic tool error", async () => {
      vi.mocked(listResumeReviews).mockRejectedValueOnce(new Error("relation does not exist"));

      expect(await bind("get_resume_reviews").run({})).toEqual({
        error: "Something went wrong while running get_resume_reviews. Please try again.",
      });
    });
  });
});

describe("mcpToolFlags over a policy (RMT-002)", () => {
  const policy = {
    alwaysAsk: ["sendThing"],
    untrustedContentTools: ["readThing"],
    gatedWriteTools: ["saveMemory", "deleteMemory", "writeNote"],
    untrustedReason: "",
    creditTools: ["spendThing"],
  };
  const flags = (...agentTools: string[]) => mcpToolFlags({ agentTools }, policy);

  it("confirms alwaysAsk tools and gated writes, since MCP has no turns", () => {
    expect(flags("sendThing")).toEqual({ credit: false, confirm: true });
    expect(flags("writeNote")).toEqual({ credit: false, confirm: true });
  });

  it("never confirms the memory writes", () => {
    expect(flags("saveMemory").confirm).toBe(false);
    expect(flags("deleteMemory").confirm).toBe(false);
  });

  it("takes the credit flag from creditTools", () => {
    expect(flags("spendThing")).toEqual({ credit: true, confirm: false });
    expect(flags("readThing")).toEqual({ credit: false, confirm: false });
  });
});
