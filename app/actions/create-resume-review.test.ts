import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { uploadResumeAction } from "./upload-resume-file";
import { createResumeReviewAction } from "./create-resume-review";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const UPLOADED_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";

let supabase: SupabaseMock;

function signIn(user: { id: string } | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const insertedReview = () =>
  supabase.callsFor("resume_reviews")[0]?.chain.find((c) => c.method === "insert")?.args[0];

beforeEach(() => {
  vi.clearAllMocks();
  signIn({ id: USER_ID });
});

describe("createResumeReviewAction", () => {
  it("refuses without a session", async () => {
    signIn(null);

    expect(await createResumeReviewAction(form({ existingResumeId: RESUME_ID }))).toEqual({
      error: "Authentication required.",
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it("creates a draft review for an existing resume", async () => {
    supabase.queue("user_info", { data: { ai_credits: 10 }, error: null });
    supabase.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });

    const result = await createResumeReviewAction(
      form({ existingResumeId: RESUME_ID, name: "Acme review" }),
    );

    expect(result).toEqual({ success: true, reviewId: REVIEW_ID });
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", USER_ID],
    });
    expect(insertedReview()).toEqual({
      user_id: USER_ID,
      resume_id: RESUME_ID,
      status: "draft",
      name: "Acme review",
      job_id: null,
      target_jd: null,
    });
    expect(uploadResumeAction).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/resume-review");
  });

  it("targets a job's description and names the review when no name is given", async () => {
    supabase.queue("all_jobs", { data: { description: "Build payments UI" }, error: null });
    supabase.queue("user_info", { data: { ai_credits: 10 }, error: null });
    supabase.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });

    await createResumeReviewAction(form({ existingResumeId: RESUME_ID, jobId: JOB_ID }));

    expect(supabase.callsFor("all_jobs")[0].chain).toContainEqual({
      method: "eq",
      args: ["id", JOB_ID],
    });
    expect(insertedReview()).toMatchObject({
      name: expect.stringMatching(/^Review [0-9a-f]{8}$/),
      job_id: JOB_ID,
      target_jd: "Build payments UI",
    });
  });

  it("refuses a job without a description", async () => {
    expect(
      await createResumeReviewAction(form({ existingResumeId: RESUME_ID, jobId: JOB_ID })),
    ).toEqual({ error: "Job description not found for the provided job." });
    expect(supabase.callsFor("resume_reviews")).toHaveLength(0);
  });

  it("refuses without a profile", async () => {
    expect(await createResumeReviewAction(form({ existingResumeId: RESUME_ID }))).toEqual({
      error: "User profile not found. Please complete your profile to create a CV review.",
    });
  });

  it("refuses without enough credits", async () => {
    supabase.queue("user_info", { data: { ai_credits: 4 }, error: null });

    expect(await createResumeReviewAction(form({ existingResumeId: RESUME_ID }))).toEqual({
      error: "Insufficient AI credits (5 required).",
    });
    expect(supabase.callsFor("resume_reviews")).toHaveLength(0);
  });

  it("uploads a new file when there's no existing resume", async () => {
    supabase.queue("user_info", { data: { ai_credits: 10 }, error: null });
    supabase.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });
    vi.mocked(uploadResumeAction).mockResolvedValue({ success: true, resumeId: UPLOADED_ID });
    const data = form({ file: new File([new Uint8Array(10)], "cv.pdf") });

    await createResumeReviewAction(data);

    expect(uploadResumeAction).toHaveBeenCalledWith(data);
    expect(insertedReview()).toMatchObject({ resume_id: UPLOADED_ID });
  });

  it("returns and reports a database error", async () => {
    supabase.queue("user_info", { data: { ai_credits: 10 }, error: null });
    supabase.queue("resume_reviews", { data: null, error: new Error("insert failed") });

    expect(await createResumeReviewAction(form({ existingResumeId: RESUME_ID }))).toEqual({
      error: "insert failed",
    });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: USER_ID,
        properties: { flow: "create_resume_review" },
      }),
    );
  });
});
