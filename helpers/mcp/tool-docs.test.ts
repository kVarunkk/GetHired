/**
 * The applicant catalog's output schemas against what the tools really
 * return: the SDK refuses a successful result that doesn't match, so a
 * schema that drifts from its tool breaks the tool.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTools } from "@/helpers/agent/tools";
import { APPLICANT_APPROVAL_POLICY } from "@/helpers/agent/approval";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { toCallToolResult } from "./results";
import { MCP_TOOLS, bindMcpTool } from "./tools";

vi.mock("@/helpers/jobs/search-jobs", () => ({ searchJobs: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const INTERVIEW_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-11-01T00:00:00.000Z";

const JOB_ROW = {
  id: JOB_ID,
  job_name: "Frontend Engineer",
  company_name: "Acme",
  locations: ["Remote"],
  salary_range: null,
  job_type: "Fulltime",
  experience: "2-5 years",
  created_at: AT,
};

let supabase: SupabaseMock;
let ctx: AgentToolContext;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  ctx = toolContext(supabase.client, { sessionId: null, surface: "mcp" });
  vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [JOB_ROW], totalCount: 1, nextCursor: "c1" } as never);
});

async function run(name: string, input: Record<string, unknown>) {
  const def = MCP_TOOLS.find((tool) => tool.name === name)!;
  const bound = bindMcpTool(def, ctx, createAgentTools(ctx), APPLICANT_APPROVAL_POLICY);
  const result = toCallToolResult(await bound.run(input));
  expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
  return { def, structured: result.structuredContent };
}

const cases: [string, Record<string, unknown>, (() => void)?][] = [
  ["search_jobs", {}],
  ["get_relevant_jobs", {}, () => {
    supabase.queue("user_info", { data: { filled: false, embedding_new: "[0.1]" }, error: null });
  }],
  ["get_similar_jobs", { jobId: JOB_ID }],
  ["get_saved_jobs", {}],
  ["get_applied_jobs", {}],
  ["get_job_details", { jobId: JOB_ID }, () => {
    supabase.queue("all_jobs", {
      data: {
        ...JOB_ROW,
        visa_requirement: "Not Required",
        platform: "gethired",
        description: "Build things.",
        ai_summary: null,
        is_platform_job: true,
      },
      error: null,
    });
  }],
  ["favorite_job", { jobId: JOB_ID, action: "unsave" }, () => {
    supabase.queue("user_favorites", { data: null, error: null });
  }],
  ["list_applications", {}, () => {
    supabase.queue("applications", {
      data: [
        {
          id: "a1",
          status: "submitted",
          created_at: AT,
          updated_at: AT,
          all_jobs: { id: JOB_ID, job_name: "Frontend Engineer", company_name: "Acme", locations: null, is_platform_job: null },
        },
        { id: "a2", status: "rejected", created_at: AT, updated_at: null, all_jobs: null },
      ],
      error: null,
    });
  }],
  ["update_application_status", { jobId: JOB_ID, status: "reviewed" }, () => {
    supabase.queue("all_jobs", {
      data: { id: JOB_ID, is_platform_job: false, job_name: "Frontend Engineer", company_name: "Acme" },
      error: null,
    });
    supabase.queue("applications", { data: [], error: null });
    supabase.queue("applications", { data: null, error: null });
  }],
  ["get_my_profile", {}, () => {
    supabase.queue("user_info", {
      data: { full_name: "Ada", email: null, ai_credits: 12, updated_at: AT, filled: true, invitations_count: 0 },
      error: null,
    });
    supabase.queueRpc("get_applicant_weekly_metrics", { data: [{ applications: 2 }], error: null });
    supabase.queue("applications", {
      data: [{ status: "submitted", created_at: AT, all_jobs: { id: JOB_ID, job_name: "FE", company_name: "Acme", platform: "gethired", locations: [] } }],
      error: null,
    });
  }],
  ["get_resumes", {}, () => {
    supabase.queue("resumes", {
      data: [{ id: RESUME_ID, name: "Main", is_primary: true, parsing_failed: false, content: {}, created_at: AT }],
      error: null,
    });
  }],
  ["get_resume_details", { resumeId: RESUME_ID }, () => {
    supabase.queue("resumes", {
      data: {
        id: RESUME_ID,
        name: "Main",
        content: { sections: [] },
        contact: { fullName: "Ada" },
        template: "classic",
        revision: 3,
        schema_version: 2,
        resume_path: null,
        created_at: AT,
        updated_at: AT,
        is_primary: true,
      },
      error: null,
    });
  }],
  ["export_resume", { resumeId: RESUME_ID }, () => {
    supabase.queue("resumes", { data: { id: RESUME_ID, name: "Main" }, error: null });
  }],
  ["get_resume_reviews", {}, () => {
    supabase.queue("resume_reviews", {
      data: [
        {
          id: "rv1",
          name: "Review",
          status: "completed",
          score: 72,
          created_at: AT,
          updated_at: AT,
          analysis_failed: false,
          resume_id: RESUME_ID,
          job_id: null,
        },
      ],
      error: null,
    });
  }],
  ["list_interviews", {}, () => {
    supabase.queue("interviews", {
      data: [
        {
          id: INTERVIEW_ID,
          name: null,
          created_at: AT,
          all_jobs: { id: JOB_ID, job_name: "FE", company_name: "Acme" },
          resumes: null,
          interview_sessions: [
            { id: "s1", started_at: AT, status: "completed", interview_analyses: [{ status: "completed", perspective: "candidate" }] },
            { id: "s2", started_at: "2026-11-02T00:00:00.000Z", status: "in_progress", interview_analyses: null },
          ],
        },
      ],
      error: null,
    });
  }],
  ["get_interview_analysis", { interviewId: INTERVIEW_ID }, () => {
    supabase.queue("interviews", { data: { id: INTERVIEW_ID, name: "Practice" }, error: null });
    supabase.queue("interview_sessions", { data: null, error: null });
  }],
  ["list_screening_interviews", {}, () => {
    supabase.queueRpc("my_screening_interviews", {
      data: [
        {
          id: "si1",
          application_id: "app1",
          job_post_id: JOB_ID,
          job_title: "FE",
          company_name: "Acme",
          status: "invited",
          created_at: AT,
          deadline_at: AT,
          completed_at: null,
          duration_minutes: 20,
          max_attempts: 2,
          attempts_used: 0,
        },
      ],
      error: null,
    });
  }],
];

describe("MCP output schemas", () => {
  it("cover every applicant tool", () => {
    for (const tool of MCP_TOOLS) expect(tool.outputSchema, tool.name).toBeDefined();
  });

  it.each(cases)("%s's result matches its output schema", async (name, input, setup) => {
    setup?.();
    const { def, structured } = await run(name, input);
    const parsed = def.outputSchema!.safeParse(structured);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("lets a confirm tool's preview and decline results through", () => {
    const schema = MCP_TOOLS.find((tool) => tool.name === "delete_resume")!.outputSchema!;
    expect(
      schema.safeParse({ needsConfirmation: true, preview: "Delete Main", confirmation_token: "ABCDE12345", instruction: "Ask." })
        .success,
    ).toBe(true);
    expect(schema.safeParse({ message: "The user declined, so nothing was done." }).success).toBe(true);
    expect(schema.safeParse({ resumeId: RESUME_ID, deleted: true, reviewsDeleted: 2 }).success).toBe(true);
  });
});
