import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertLimit } from "@/helpers/billing/entitlements";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { myCompanyOf } from "@/test/utils/team";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { setJobPostStatus } from "./set-job-post-status";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));

const POST = jobPostingOf(COMPANY_A, { status: "inactive" });
const company = myCompanyOf(COMPANY_A);

let db: SupabaseMock;
let service: SupabaseMock;

const run = (status: "active" | "inactive" = "active") =>
  setJobPostStatus({ supabase: db.client, company }, { jobPostingId: POST.id, status });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  db.queue("job_postings", { data: POST, error: null });
});

// SM-ISS-008, SM-REQ-007: one RPC changes job_postings and all_jobs together.
describe("setJobPostStatus", () => {
  it("changes the status through one set_job_post_status call, never all_jobs directly", async () => {
    db.queueRpc("set_job_post_status", { data: { ok: true, job_id: POST.job_id, changed: true }, error: null });

    expect(await run()).toEqual({ ok: true });

    const calls = db.callsFor("set_job_post_status");
    expect(calls).toHaveLength(1);
    expect(calls[0].chain[0].args[1]).toEqual({ p_job_post_id: POST.id, p_status: "active" });
    expect(db.callsFor("all_jobs")).toHaveLength(0);
    expect(service.callsFor("all_jobs")).toHaveLength(0);
    expect(db.calls.concat(service.calls).filter((c) => c.chain.some((m) => m.method === "update"))).toHaveLength(0);
  });

  it("revalidates the job, its page and the careers company tag after it succeeds", async () => {
    db.queueRpc("set_job_post_status", { data: { ok: true, job_id: POST.job_id, changed: true }, error: null });

    await run();

    expect(revalidateTag).toHaveBeenCalledWith(`job-${POST.job_id}`);
    expect(revalidateTag).toHaveBeenCalledWith(careersCompanyTag(COMPANY_A.id));
    expect(revalidatePath).toHaveBeenCalledWith(`/jobs/${POST.job_id}`);
  });

  it("calls the RPC even when the post already has that status, so a retry repairs all_jobs", async () => {
    db.reset();
    db.queue("job_postings", { data: { ...POST, status: "active" }, error: null });
    db.queueRpc("set_job_post_status", { data: { ok: true, job_id: POST.job_id, changed: false }, error: null });

    expect(await run("active")).toEqual({ ok: true });
    expect(db.callsFor("set_job_post_status")).toHaveLength(1);
    // Nothing is being activated, so the limit isn't checked.
    expect(assertLimit).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith(`job-${POST.job_id}`);
  });

  it.each([
    [{ data: null, error: { message: "boom" } }, "Failed to update the job posting."],
    [{ data: { ok: false, reason: "forbidden" }, error: null }, "Your role can't open, pause or close job posts."],
    [{ data: { ok: false, reason: "not_found" }, error: null }, "Job posting not found."],
  ])("revalidates nothing when the RPC fails (%o)", async (response, error) => {
    db.queueRpc("set_job_post_status", response);

    expect(await run()).toEqual({ ok: false, error });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
