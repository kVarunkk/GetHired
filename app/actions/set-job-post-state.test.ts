import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { cancelOpenScreeningInterviews } from "@/helpers/jobs/job-interviews";
import { setJobPostState } from "@/helpers/jobs/set-job-post-state";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { myCompanyOf } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { setJobPostStateAction } from "./set-job-post-state";

vi.mock("@/helpers/companies/require-company", () => ({ requireCompanyForAction: vi.fn() }));
vi.mock("@/helpers/jobs/set-job-post-state", () => ({ setJobPostState: vi.fn() }));
vi.mock("@/helpers/jobs/job-interviews", () => ({ cancelOpenScreeningInterviews: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-000000000001";
const company = myCompanyOf(COMPANY_A);
const db = createSupabaseMock({ user: COMPANY_A.user });
const moved = (state: "closed" | "filled" | "paused", changed = true) => ({
  ok: true as const,
  changed,
  from: "open" as const,
  state,
  jobId: "d0000000-0000-4000-8000-000000000001",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCompanyForAction).mockResolvedValue({
    ok: true,
    supabase: db.client,
    company,
    user: COMPANY_A.user,
  } as never);
  vi.mocked(cancelOpenScreeningInterviews).mockResolvedValue({ ok: true, cancelled: 2, failed: 0 });
});

describe("setJobPostStateAction (JLT-017)", () => {
  it("checks jobs.publish on the job, from the session", async () => {
    vi.mocked(setJobPostState).mockResolvedValue(moved("paused"));
    await setJobPostStateAction({ jobPostId: JOB, to: "paused" });
    expect(requireCompanyForAction).toHaveBeenCalledWith({ permission: "jobs.publish", jobId: JOB });
    expect(setJobPostState).toHaveBeenCalledWith(
      expect.objectContaining({ company }),
      { jobPostId: JOB, to: "paused", reason: undefined, note: undefined },
    );
  });

  it("stops at the permission check", async () => {
    vi.mocked(requireCompanyForAction).mockResolvedValue({ ok: false, error: "Your role can't open, pause or close job posts." } as never);
    expect(await setJobPostStateAction({ jobPostId: JOB, to: "paused" })).toEqual({
      ok: false,
      error: "Your role can't open, pause or close job posts.",
    });
    expect(setJobPostState).not.toHaveBeenCalled();
  });

  it("D9: leaves AI interviews alone by default", async () => {
    vi.mocked(setJobPostState).mockResolvedValue(moved("closed"));
    await setJobPostStateAction({ jobPostId: JOB, to: "closed", reason: "cancelled" });
    expect(cancelOpenScreeningInterviews).not.toHaveBeenCalled();
  });

  it.each(["closed", "filled"] as const)("D9: cancels open AI interviews after a %s move that applied", async (to) => {
    vi.mocked(setJobPostState).mockResolvedValue(moved(to));
    expect(
      await setJobPostStateAction({ jobPostId: JOB, to, reason: "cancelled", cancelOpenInterviews: true }),
    ).toMatchObject({ ok: true, interviewsCancelled: 2 });
    expect(cancelOpenScreeningInterviews).toHaveBeenCalledWith(expect.objectContaining({ company }), JOB);
  });

  it("cancels nothing when the move was refused, didn't change anything, or isn't a close", async () => {
    vi.mocked(setJobPostState).mockResolvedValueOnce({ ok: false, error: "nope" });
    await setJobPostStateAction({ jobPostId: JOB, to: "closed", reason: "other", cancelOpenInterviews: true });
    vi.mocked(setJobPostState).mockResolvedValueOnce(moved("closed", false));
    await setJobPostStateAction({ jobPostId: JOB, to: "closed", reason: "other", cancelOpenInterviews: true });
    vi.mocked(setJobPostState).mockResolvedValueOnce(moved("paused"));
    await setJobPostStateAction({ jobPostId: JOB, to: "paused", cancelOpenInterviews: true });
    expect(cancelOpenScreeningInterviews).not.toHaveBeenCalled();
  });

  it("reports a cancel failure without undoing the move", async () => {
    vi.mocked(setJobPostState).mockResolvedValue(moved("filled"));
    vi.mocked(cancelOpenScreeningInterviews).mockResolvedValue({
      ok: false,
      error: "Your role can't manage AI interviews for this job.",
    });
    expect(await setJobPostStateAction({ jobPostId: JOB, to: "filled", cancelOpenInterviews: true })).toMatchObject({
      ok: true,
      state: "filled",
      interviewsError: "Your role can't manage AI interviews for this job.",
    });
  });
});
