import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { importClaimResume } from "@/helpers/candidates/claim-prefill";
import { submitOnboardingAction } from "./submit-onboarding";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/user/complete-onboarding", () => ({ completeApplicantOnboarding: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/helpers/candidates/claim-prefill", () => ({ importClaimResume: vi.fn() }));
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

function form(fields: { profile?: object; resumeId?: string; file?: File; claimToken?: string }) {
  const data = new FormData();
  data.append("profileData", JSON.stringify(fields.profile ?? PROFILE));
  if (fields.resumeId) data.append("resumeId", fields.resumeId);
  if (fields.file) data.append("resumeFile", fields.file);
  if (fields.claimToken) data.append("claimToken", fields.claimToken);
  return data;
}

function signIn(user: typeof SESSION_USER | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn(SESSION_USER);
  vi.mocked(completeApplicantOnboarding).mockResolvedValue({ ok: true });
});

describe("submitOnboardingAction", () => {
  it("completes onboarding for the session user with the resume from Step 6", async () => {
    expect(await submitOnboardingAction(form({ resumeId: RESUME_ID }))).toEqual({ success: true });

    expect(completeApplicantOnboarding).toHaveBeenCalledWith(
      SESSION_USER,
      PROFILE,
      { resumeId: RESUME_ID, shouldParse: false },
    );
  });

  it("waits for no parse and writes no resume itself (RE-REQ-021)", async () => {
    await submitOnboardingAction(form({ resumeId: RESUME_ID }));

    expect(supabase.callsFor("resumes")).toHaveLength(0);
    expect(importClaimResume).not.toHaveBeenCalled();
  });

  it("ignores a file: Step 6 has already parsed it", async () => {
    const file = new File([new Uint8Array(10)], "cv.pdf");

    expect(await submitOnboardingAction(form({ file }))).toEqual({ error: "Please upload your resume." });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("requires a resume", async () => {
    expect(await submitOnboardingAction(form({}))).toEqual({ error: "Please upload your resume." });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("validates the profile", async () => {
    const result = await submitOnboardingAction(
      form({ profile: { ...PROFILE, full_name: "" }, resumeId: RESUME_ID }),
    );

    expect(result).toEqual({ error: expect.stringContaining("full_name") });
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

    expect(vi.mocked(completeApplicantOnboarding).mock.calls[0][0]).toEqual(SESSION_USER);
  });

  describe("the claimed company's resume (BIT-105)", () => {
    const TOKEN = "t".repeat(43);

    it("imports it, already parsed", async () => {
      vi.mocked(importClaimResume).mockResolvedValue({ ok: true, resumeId: "imported" });

      expect(await submitOnboardingAction(form({ claimToken: TOKEN }))).toEqual({ success: true });

      expect(importClaimResume).toHaveBeenCalledWith(supabase.client, expect.anything(), SESSION_USER, TOKEN);
      expect(vi.mocked(completeApplicantOnboarding).mock.calls[0][2]).toEqual({ resumeId: "imported", shouldParse: false });
    });

    it("is ignored when they chose another resume", async () => {
      await submitOnboardingAction(form({ claimToken: TOKEN, resumeId: RESUME_ID }));

      expect(importClaimResume).not.toHaveBeenCalled();
      expect(vi.mocked(completeApplicantOnboarding).mock.calls[0][2]).toEqual({ resumeId: RESUME_ID, shouldParse: false });
    });

    it("saves nothing when the import is refused", async () => {
      vi.mocked(importClaimResume).mockResolvedValue({ ok: false, error: "That resume is no longer available. Upload your own." });

      expect(await submitOnboardingAction(form({ claimToken: TOKEN }))).toEqual({
        error: "That resume is no longer available. Upload your own.",
      });
      expect(completeApplicantOnboarding).not.toHaveBeenCalled();
    });

    it("needs a valid profile before importing", async () => {
      expect(await submitOnboardingAction(form({ claimToken: TOKEN, profile: { ...PROFILE, full_name: "" } }))).toMatchObject({
        error: expect.stringContaining("full_name"),
      });
      expect(importClaimResume).not.toHaveBeenCalled();
    });
  });
});
