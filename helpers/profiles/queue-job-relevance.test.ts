import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { HIRING_MANAGER_A, JOB_A2, myCompanyOf, OWNER_A } from "@/test/utils/team";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { queueJobPostingRelevance } from "./queue-job-relevance";

// RMT-025a: the core of triggerJobPostingRelevanceUpdate, callable from MCP
// with the session it already resolved. The action's own tests cover the
// queueing itself.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

const OWN = jobPostingOf(COMPANY_A);
let supabase: SupabaseMock;
let service: SupabaseMock;
const sent = () => service.callsFor("send").map((c) => c.chain[0].args[1]);

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock({ user: OWNER_A.user });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("queueJobPostingRelevance (RMT-025a)", () => {
  const start = (data: unknown, error: unknown = null) => supabase.queueRpc("start_matching", { data, error });
  const ctx = () => ({ supabase: supabase.client, company: myCompanyOf(COMPANY_A), user: OWNER_A.user });

  it("starts through start_matching with the given session, then queues under the owner's id, without reading the request", async () => {
    start({ ok: true });

    const result = await queueJobPostingRelevance(ctx(), OWN.id);

    expect(result).toEqual({ success: true, message: "processing started" });
    // SM-REQ-004: one atomic start, checked by the database for the session.
    expect(supabase.callsFor("start_matching")[0].chain[0].args[1]).toEqual({
      p_job_id: OWN.id,
      p_timeout_seconds: 1200,
    });
    expect(sent()).toEqual([
      { queue_name: "relevance_profiles", message: { userId: COMPANY_A.user.id, jobId: OWN.id }, sleep_seconds: 0 },
    ]);
    expect(service.callsFor("job_postings")).toHaveLength(0);
    expect(getUserFromRequest).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends no message when a run is going (SM-TEST-005)", async () => {
    start({ ok: false, reason: "in_progress" });

    const result = await queueJobPostingRelevance(ctx(), OWN.id);

    expect(result).toEqual({ success: false, error: "Matching is already in progress for this job." });
    expect(sent()).toHaveLength(0);
  });

  it.each(["not_found", "forbidden"])("answers not found when the start says %s", async (reason) => {
    start({ ok: false, reason });

    expect(await queueJobPostingRelevance(ctx(), OWN.id)).toEqual({ success: false, error: "Job posting not found." });
    expect(sent()).toHaveLength(0);
  });

  it("fails without sending when the start errors", async () => {
    start(null, { message: "db down" });

    expect(await queueJobPostingRelevance(ctx(), OWN.id)).toEqual({ success: false, error: "Failed to start matching." });
    expect(sent()).toHaveLength(0);
  });

  it("moves the job to failed from progress only when the message can't be sent", async () => {
    start({ ok: true });
    service.queueRpc("send", { data: null, error: { message: "queue down" } }, "pgmq_public");

    const result = await queueJobPostingRelevance(ctx(), OWN.id);

    expect(result).toEqual({ success: false, error: "Failed to start matching." });
    const [failed] = service.callsFor("job_postings");
    expect(failed.chain.find((m) => m.method === "update")!.args[0]).toMatchObject({ matching_status: "failed" });
    expect(failed.chain).toContainEqual({ method: "eq", args: ["id", OWN.id] });
    expect(failed.chain).toContainEqual({ method: "in", args: ["matching_status", ["progress"]] });
  });

  it("re-checks matching.run for the job", async () => {
    const company = HIRING_MANAGER_A.myCompany;
    const result = await queueJobPostingRelevance({ supabase: supabase.client, company, user: HIRING_MANAGER_A.user }, JOB_A2);
    expect(result).toEqual({ success: false, error: forbiddenMessage("matching.run", { forJob: true }) });
    expect(supabase.calls).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  it("refuses a malformed id", async () => {
    expect(
      await queueJobPostingRelevance({ supabase: supabase.client, company: myCompanyOf(COMPANY_A) }, "nope"),
    ).toEqual({ success: false, error: "Job posting not found." });
  });
});
