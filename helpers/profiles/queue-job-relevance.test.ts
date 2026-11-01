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
  it("queues under the owner's id with the given session, without reading the request", async () => {
    supabase.queue("job_postings", { data: { id: OWN.id, matching_status: "completed", updated_at: OWN.updated_at }, error: null });

    const result = await queueJobPostingRelevance(
      { supabase: supabase.client, company: myCompanyOf(COMPANY_A), user: OWNER_A.user },
      OWN.id,
    );

    expect(result).toEqual({ success: true, message: "processing started" });
    expect(sent()).toEqual([
      { queue_name: "relevance_profiles", message: { userId: COMPANY_A.user.id, jobId: OWN.id }, sleep_seconds: 0 },
    ]);
    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(getUserFromRequest).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("re-checks matching.run for the job", async () => {
    const company = HIRING_MANAGER_A.myCompany;
    const result = await queueJobPostingRelevance({ supabase: supabase.client, company, user: HIRING_MANAGER_A.user }, JOB_A2);
    expect(result).toEqual({ success: false, error: forbiddenMessage("matching.run", { forJob: true }) });
    expect(supabase.callsFor("job_postings")).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  it("refuses a malformed id", async () => {
    expect(
      await queueJobPostingRelevance({ supabase: supabase.client, company: myCompanyOf(COMPANY_A) }, "nope"),
    ).toEqual({ success: false, error: "Job posting not found." });
  });
});
