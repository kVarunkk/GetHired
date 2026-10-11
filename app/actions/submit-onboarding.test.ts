import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { submitOnboardingAction } from "./submit-onboarding";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/user/complete-onboarding", () => ({ completeApplicantOnboarding: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_USER = { id: USER_ID, email: "ada@example.com" };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

/** The payload OnboardingComponent sends. */
const PROFILE = {
  user_id: USER_ID,
  email: "ada@example.com",
  full_name: "Ada Lovelace",
  desired_roles: ["Frontend Engineer"],
  job_type: ["Fulltime"],
  salary_currency: "₹",
  min_salary: 1500000,
  preferred_locations: ["Bengaluru"],
  experience_years: 4,
  top_skills: ["React"],
  work_style_preferences: ["Remote"],
  company_size_preference: "Any",
  filled: true,
};

let supabase: SupabaseMock;
let upload: ReturnType<typeof vi.fn>;

function form(fields: { profile?: object; resumeId?: string; file?: File }) {
  const data = new FormData();
  data.append("profileData", JSON.stringify(fields.profile ?? PROFILE));
  if (fields.resumeId) data.append("resumeId", fields.resumeId);
  if (fields.file) data.append("resumeFile", fields.file);
  return data;
}

const pdf = () => new File([new Uint8Array(10)], "My CV.pdf", { type: "application/pdf" });

function signIn(user: typeof SESSION_USER | null, credits = 20) {
  supabase = createSupabaseMock({ user });
  upload = vi.fn().mockResolvedValue({ error: null });
  Object.assign(supabase.client, { storage: { from: () => ({ upload }) } });
  supabase.queue("user_info", { data: { ai_credits: credits }, error: null });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  signIn(SESSION_USER);
  vi.mocked(completeApplicantOnboarding).mockResolvedValue({ ok: true });
});

describe("submitOnboardingAction", () => {
  it("completes onboarding for the session user with an existing resume", async () => {
    expect(await submitOnboardingAction(form({ resumeId: RESUME_ID }))).toEqual({ success: true });

    expect(completeApplicantOnboarding).toHaveBeenCalledWith(
      supabase.client,
      SESSION_USER,
      PROFILE,
      { resumeId: RESUME_ID, shouldParse: false },
    );
  });

  it("uploads a new file, creates the resume and asks the pipeline to parse it", async () => {
    supabase.queue("resumes", { data: { id: "new-resume" }, error: null });

    expect(await submitOnboardingAction(form({ file: pdf() }))).toEqual({ success: true });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^resumes/${USER_ID}/\\d+-My_CV\\.pdf$`)),
      expect.anything(),
      { contentType: "application/pdf" },
    );
    expect(supabase.callsFor("resumes")[0].chain[0]).toMatchObject({
      method: "insert",
      args: [expect.objectContaining({ user_id: USER_ID, name: "My CV.pdf", content: null })],
    });
    expect(vi.mocked(completeApplicantOnboarding).mock.calls[0][3]).toEqual({
      resumeId: "new-resume",
      shouldParse: true,
    });
  });

  it("refuses a new file without enough AI credits, before writing anything", async () => {
    signIn(SESSION_USER, 1);

    expect(await submitOnboardingAction(form({ file: pdf() }))).toEqual({
      error: "Insufficient AI credits for resume upload. Please top up to continue.",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("requires a resume", async () => {
    expect(await submitOnboardingAction(form({}))).toEqual({ error: "Please upload your resume." });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("validates the profile before uploading anything", async () => {
    const result = await submitOnboardingAction(
      form({ profile: { ...PROFILE, full_name: "" }, file: pdf() }),
    );

    expect(result).toEqual({ error: expect.stringContaining("full_name") });
    expect(upload).not.toHaveBeenCalled();
    expect(supabase.callsFor("resumes")).toHaveLength(0);
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("returns the helper's validation errors", async () => {
    vi.mocked(completeApplicantOnboarding).mockResolvedValue({
      ok: false,
      error: "Invalid full_name: Too small",
    });

    expect(await submitOnboardingAction(form({ resumeId: RESUME_ID }))).toEqual({
      error: "Invalid full_name: Too small",
    });
  });

  it("reports and returns unexpected errors", async () => {
    vi.mocked(completeApplicantOnboarding).mockRejectedValue(new Error("queue down"));

    expect(await submitOnboardingAction(form({ resumeId: RESUME_ID }))).toEqual({
      error: "queue down",
    });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: USER_ID, properties: { flow: "submit_onboarding" } }),
    );
  });

  it("requires a signed-in user", async () => {
    signIn(null);

    expect(await submitOnboardingAction(form({ resumeId: RESUME_ID }))).toEqual({
      error: "Authentication required.",
    });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  // Flipped from the characterisation test that pinned the unsafe behaviour (SEC-009).
  it("ignores a user id in the form: the session user is always used", async () => {
    await submitOnboardingAction(
      form({ profile: { ...PROFILE, user_id: "someone-else" }, resumeId: RESUME_ID }),
    );

    expect(vi.mocked(completeApplicantOnboarding).mock.calls[0][1]).toEqual(SESSION_USER);
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", USER_ID],
    });
  });
});
