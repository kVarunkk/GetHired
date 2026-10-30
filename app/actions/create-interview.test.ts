import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createInterviewAction } from "./create-interview";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const INTERVIEW_ID = "55555555-5555-4555-8555-555555555555";

let supabase: SupabaseMock;

function signIn(user: { id: string } | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

const insertedInterview = () =>
  supabase.callsFor("interviews")[0]?.chain.find((c) => c.method === "insert")?.args[0];

beforeEach(() => {
  vi.clearAllMocks();
  signIn({ id: USER_ID });
});

describe("createInterviewAction", () => {
  it("refuses without a session", async () => {
    signIn(null);

    expect(await createInterviewAction("Mock", RESUME_ID, JOB_ID)).toEqual({
      error: "Authentication required.",
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it("creates an interview for the job and resume", async () => {
    supabase.queue("user_info", { data: { filled: true, ai_credits: 20 }, error: null });
    supabase.queue("all_jobs", { data: { id: JOB_ID }, error: null });
    supabase.queue("interviews", { data: { id: INTERVIEW_ID }, error: null });

    expect(await createInterviewAction("Acme mock", RESUME_ID, JOB_ID)).toEqual({
      success: true,
      interviewId: INTERVIEW_ID,
    });
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", USER_ID],
    });
    expect(insertedInterview()).toEqual({
      user_id: USER_ID,
      resume_id: RESUME_ID,
      name: "Acme mock",
      job_id: JOB_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/interviews");
  });

  it("names the interview when no name is given", async () => {
    supabase.queue("user_info", { data: { filled: true, ai_credits: 20 }, error: null });
    supabase.queue("all_jobs", { data: { id: JOB_ID }, error: null });
    supabase.queue("interviews", { data: { id: INTERVIEW_ID }, error: null });

    await createInterviewAction(null, RESUME_ID, JOB_ID);

    expect(insertedInterview()).toMatchObject({
      name: expect.stringMatching(/^AI Interview [0-9a-f]{8}$/),
    });
  });

  it.each([
    ["no profile", null, "User profile not found. Please complete your profile to create an interview."],
    [
      "an unfinished profile",
      { filled: false, ai_credits: 10 },
      "User profile is incomplete. Please complete onboarding to use this feature.",
    ],
    ["too few credits", { filled: true, ai_credits: 9 }, "Insufficient AI credits (10 required)."],
  ])("refuses with %s", async (_label, profile, error) => {
    supabase.queue("user_info", { data: profile, error: null });

    expect(await createInterviewAction(null, RESUME_ID, JOB_ID)).toEqual({ error });
    expect(supabase.callsFor("interviews")).toHaveLength(0);
  });

  it("refuses an unknown job", async () => {
    supabase.queue("user_info", { data: { filled: true, ai_credits: 20 }, error: null });

    expect(await createInterviewAction(null, RESUME_ID, JOB_ID)).toEqual({
      error: "Job not found. Please provide a valid job URL.",
    });
    expect(supabase.callsFor("interviews")).toHaveLength(0);
  });

  it("returns and reports a database error", async () => {
    supabase.queue("user_info", { data: { filled: true, ai_credits: 20 }, error: null });
    supabase.queue("all_jobs", { data: { id: JOB_ID }, error: null });
    supabase.queue("interviews", { data: null, error: new Error("insert failed") });

    expect(await createInterviewAction(null, RESUME_ID, JOB_ID)).toEqual({ error: "insert failed" });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: USER_ID, properties: { flow: "create_interview" } }),
    );
  });
});
