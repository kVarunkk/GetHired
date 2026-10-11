import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOnboardingTools } from "./onboarding";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import { canonicalizeLocations } from "@/helpers/locations/aliases";

vi.mock("@/helpers/user/complete-onboarding", () => ({ completeApplicantOnboarding: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const RESUME_ID = "22222222-2222-4222-8222-222222222222";

/** Every required field, as the model sends them. */
const INPUT = {
  fullName: "Ada Lovelace",
  desiredRoles: ["Frontend Engineer"],
  jobTypes: ["Fulltime"],
  salaryCurrency: "₹",
  minSalary: 1500000,
  preferredLocations: ["Bangalore"],
  experienceYears: 4,
  topSkills: ["React"],
  workStylePreferences: ["Remote"],
  companySizePreference: "Any",
};

const readyResume = { id: RESUME_ID, name: "CV 2026", content: { a: 1 }, parsing_failed: false };

let supabase: SupabaseMock;
let tools: ReturnType<typeof createOnboardingTools>;

beforeEach(() => {
  supabase = createSupabaseMock();
  tools = createOnboardingTools(toolContext(supabase.client));
  supabase.queue("user_info", { data: { filled: false }, error: null });
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((name) => (name === "Bangalore" ? "Bengaluru" : name)),
  );
  vi.mocked(completeApplicantOnboarding).mockResolvedValue({ ok: true });
});

describe("completeOnboarding tool", () => {
  it("requires the user's approval", () => {
    expect(tools.completeOnboarding.needsApproval).toBe(true);
  });

  it("onboards the ctx user with their resume, saving canonical locations", async () => {
    supabase.queue("resumes", { data: readyResume, error: null });

    const result = await execTool(tools.completeOnboarding, {
      ...INPUT,
      resumeId: RESUME_ID,
      linkedinUrl: "https://linkedin.com/in/ada",
      careerGoalsShortTerm: "Lead a frontend team",
    });

    expect(supabase.callsFor("user_info")[0].chain).toEqual([
      { method: "select", args: ["filled"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id, name, content, parsing_failed"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(completeApplicantOnboarding).toHaveBeenCalledWith(
      supabase.client,
      expect.objectContaining({ id: "u1", email: "ada@example.com" }),
      {
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
        linkedin_url: "https://linkedin.com/in/ada",
        career_goals_short_term: "Lead a frontend team",
      },
      // The agent's upload already parsed (and charged for) the resume.
      { resumeId: RESUME_ID, shouldParse: false },
    );
    // The resume used is reported, so the chat can show it.
    expect(result).toEqual({
      onboarded: true,
      resume: { id: RESUME_ID, name: "CV 2026" },
      preferredLocations: ["Bengaluru"],
    });
  });

  it("uses the primary resume when none is given", async () => {
    supabase.queue("resumes", { data: readyResume, error: null });

    await execTool(tools.completeOnboarding, INPUT);

    expect(supabase.callsFor("resumes")[0].chain).toContainEqual({
      method: "eq",
      args: ["is_primary", true],
    });
  });

  it("asks for a resume upload when the user has none", async () => {
    supabase.queue("resumes", { data: null, error: null });

    expect(await execTool(tools.completeOnboarding, INPUT)).toMatchObject({
      error: "NO_RESUME",
      message: expect.stringContaining("requestResumeUpload"),
    });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...readyResume, parsing_failed: true }, "This resume couldn't be read. Ask the user to upload it again."],
    [{ ...readyResume, content: null }, "This resume is still being processed. Try again in a minute."],
  ])("waits for a readable resume (%o)", async (resume, error) => {
    supabase.queue("resumes", { data: resume, error: null });

    expect(await execTool(tools.completeOnboarding, INPUT)).toEqual({ error });
    expect(completeApplicantOnboarding).not.toHaveBeenCalled();
  });

  it("refuses to run again for an onboarded user", async () => {
    supabase = createSupabaseMock();
    tools = createOnboardingTools(toolContext(supabase.client));
    supabase.queue("user_info", { data: { filled: true }, error: null });

    expect(await execTool(tools.completeOnboarding, INPUT)).toMatchObject({
      error: "ALREADY_ONBOARDED",
      message: expect.stringContaining("updateMyPreferences"),
    });
    expect(supabase.callsFor("resumes")).toHaveLength(0);
  });

  it("returns the helper's errors", async () => {
    supabase.queue("resumes", { data: readyResume, error: null });
    vi.mocked(completeApplicantOnboarding).mockResolvedValue({ ok: false, error: "Profile not found." });

    expect(await execTool(tools.completeOnboarding, INPUT)).toEqual({ error: "Profile not found." });
  });

  it.each([
    ["a missing required field", { ...INPUT, fullName: undefined }],
    ["an unknown job type", { ...INPUT, jobTypes: ["Gig"] }],
    ["an unknown company size", { ...INPUT, companySizePreference: "Huge" }],
    ["an unknown currency", { ...INPUT, salaryCurrency: "BTC" }],
    ["max below min salary", { ...INPUT, maxSalary: 10 }],
    ["a user id", { ...INPUT, userId: "someone-else" }],
  ])("rejects input with %s", async (_label, input) => {
    expect((await validateInput(tools.completeOnboarding, input)).success).toBe(false);
  });
});
