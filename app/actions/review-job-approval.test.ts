import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { JOB_STATE_REFUSALS } from "@/helpers/jobs/job-state-copy";
import { setJobPostState } from "@/helpers/jobs/set-job-post-state";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { myCompanyOf } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { reviewJobApprovalAction } from "./review-job-approval";

vi.mock("@/helpers/companies/require-company", () => ({ requireCompanyForAction: vi.fn() }));
vi.mock("@/helpers/jobs/set-job-post-state", () => ({ setJobPostState: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-000000000001";
const company = myCompanyOf(COMPANY_A);
const db = createSupabaseMock({ user: COMPANY_A.user });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCompanyForAction).mockResolvedValue({
    ok: true,
    supabase: db.client,
    company,
    user: COMPANY_A.user,
  } as never);
  vi.mocked(setJobPostState).mockResolvedValue({
    ok: true,
    changed: true,
    from: "pending_approval",
    state: "open",
    jobId: "d0000000-0000-4000-8000-000000000001",
  });
});

describe("reviewJobApprovalAction (JLT-053)", () => {
  it("checks jobs.approve on the job and opens a pending job", async () => {
    expect(await reviewJobApprovalAction({ jobPostId: JOB, decision: "approve" })).toMatchObject({ ok: true, state: "open" });
    expect(requireCompanyForAction).toHaveBeenCalledWith({ permission: "jobs.approve", jobId: JOB });
    expect(setJobPostState).toHaveBeenCalledWith(expect.objectContaining({ company }), {
      jobPostId: JOB,
      to: "open",
      note: null,
      from: ["pending_approval"],
    });
  });

  it("sends a pending job back to a draft with the note", async () => {
    await reviewJobApprovalAction({ jobPostId: JOB, decision: "request_changes", note: "  Fix the salary " });
    expect(setJobPostState).toHaveBeenCalledWith(expect.anything(), {
      jobPostId: JOB,
      to: "draft",
      note: "Fix the salary",
      from: ["pending_approval"],
    });
  });

  it("needs a note to request changes", async () => {
    expect(await reviewJobApprovalAction({ jobPostId: JOB, decision: "request_changes", note: "  " })).toEqual({
      ok: false,
      error: JOB_STATE_REFUSALS.note_required,
    });
    expect(setJobPostState).not.toHaveBeenCalled();
  });

  it("refuses an unknown decision", async () => {
    expect(await reviewJobApprovalAction({ jobPostId: JOB, decision: "maybe" as never })).toEqual({
      ok: false,
      error: JOB_STATE_REFUSALS.invalid_transition,
    });
    expect(setJobPostState).not.toHaveBeenCalled();
  });

  it("stops at the permission check", async () => {
    vi.mocked(requireCompanyForAction).mockResolvedValue({ ok: false, error: forbiddenMessage("jobs.approve") } as never);
    expect(await reviewJobApprovalAction({ jobPostId: JOB, decision: "approve" })).toEqual({
      ok: false,
      error: "Your role can't approve job posts.",
    });
    expect(setJobPostState).not.toHaveBeenCalled();
  });
});
