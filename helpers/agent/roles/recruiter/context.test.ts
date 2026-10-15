import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecruiterPromptContext } from "./context";
import { RA_PROMPT_JOBS } from "./config";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));

const COMPANY = { id: COMPANY_A.id, name: "Acme", email: "hr@acme.dev" };
const JOB = {
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Backend",
  status: "active",
  matching_status: "completed",
  applicants: 3,
  new_24h: 1,
  created_at: "c",
  updated_at: "u",
};

const state = (amount: number | null, used = 0) => ({
  kind: "allowance",
  amount,
  used,
  held: 0,
  remaining: amount === null ? null : amount - used,
  overageCredits: null,
});

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
  vi.mocked(getEntitlements).mockResolvedValue({
    tier: { id: "t", slug: "startup", name: "Startup" },
    creditBalance: 9,
    entitlements: {
      active_job_posts: state(5, 2),
      profiles_per_search: state(50),
      screenings: state(100, 20),
      agent_messages: state(null),
    },
  } as never);
});

describe("loadRecruiterPromptContext", () => {
  it("loads the job summaries and the plan for the session's company", async () => {
    supabase.queueRpc("get_recruiter_job_summaries", { data: [JOB], error: null });

    const context = await loadRecruiterPromptContext(supabase.client, COMPANY);

    expect(supabase.callsFor("get_recruiter_job_summaries")[0].chain[0].args).toEqual([
      "get_recruiter_job_summaries",
      { p_company_id: COMPANY_A.id, p_limit: RA_PROMPT_JOBS },
    ]);
    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    expect(context).toEqual({
      company: { name: "Acme" },
      plan: {
        name: "Startup",
        creditBalance: 9,
        remaining: { activeJobPosts: 3, profilesPerSearch: 50, screenings: 80, agentMessages: null },
      },
      jobs: [JOB],
    });
  });

  it("still returns the jobs when the plan can't be loaded", async () => {
    supabase.queueRpc("get_recruiter_job_summaries", { data: [JOB], error: null });
    vi.mocked(getEntitlements).mockRejectedValue(new Error("down"));

    const context = await loadRecruiterPromptContext(supabase.client, COMPANY);

    expect(context.plan).toBeNull();
    expect(context.jobs).toEqual([JOB]);
  });

  it("throws on an RPC error", async () => {
    supabase.queueRpc("get_recruiter_job_summaries", { data: null, error: { message: "boom" } });

    await expect(loadRecruiterPromptContext(supabase.client, COMPANY)).rejects.toThrow();
  });
});
