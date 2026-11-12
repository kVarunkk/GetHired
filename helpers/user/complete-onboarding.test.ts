import { RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { completeApplicantOnboarding } from "./complete-onboarding";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/user/set-app-metadata", () => ({ setUserAppMetadata: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001", email: "ada@example.com" };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

/** Every required field (REQ-020), as the form and the tool send them. */
const REQUIRED = {
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
};

let service: SupabaseMock;

const run = (input: unknown, options = { resumeId: RESUME_ID, shouldParse: false }) =>
  completeApplicantOnboarding(USER, input, options);

/** The arguments of the one complete_applicant_onboarding call. */
const argsOf = () => {
  const calls = service.callsFor("complete_applicant_onboarding");
  expect(calls).toHaveLength(1);
  return calls[0].chain[0].args[1] as Record<string, unknown> & { p_profile: Record<string, unknown> };
};

beforeEach(() => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(setUserAppMetadata).mockReset();
  vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null });
  vi.mocked(updateUserEmbedding).mockReset();
  service.queueRpc("complete_applicant_onboarding", { data: { ok: true, queued: true }, error: null });
});

describe("completeApplicantOnboarding", () => {
  it("writes the profile, primary resume and pipeline message in one call, then marks onboarding complete", async () => {
    expect(await run({ ...REQUIRED, max_salary: 2500000 })).toEqual({ ok: true });

    // One transaction: no separate table writes or queue send.
    expect(service.calls.map((c) => c.target)).toEqual(["complete_applicant_onboarding"]);
    expect(argsOf()).toEqual({
      p_user_id: USER.id,
      p_resume_id: RESUME_ID,
      p_profile: { ...REQUIRED, max_salary: 2500000 },
      p_email: USER.email,
      p_should_parse: false,
      p_stale_seconds: RELEVANCE_TIMEOUT_MS / 1000,
    });
    // The pipeline embeds.
    expect(updateUserEmbedding).not.toHaveBeenCalled();

    // Only the flag: the account type is set at sign-up and never changed here.
    expect(setUserAppMetadata).toHaveBeenCalledWith(USER.id, { onboarding_complete: true });
  });

  it("sends only allowlisted columns, whatever the input contains (SEC-009)", async () => {
    await run({ ...REQUIRED, user_id: "someone-else", ai_credits: 9999, filled: false, email: "x@y.z" });

    const { p_profile, p_user_id } = argsOf();
    for (const field of ["ai_credits", "user_id", "filled", "email"]) {
      expect(p_profile).not.toHaveProperty(field);
    }
    expect(p_user_id).toBe(USER.id);
  });

  it("turns empty optional text into null and keeps optional fields", async () => {
    await run({
      ...REQUIRED,
      linkedin_url: "",
      github_url: "https://github.com/ada",
      career_goals_short_term: "Ship a design system",
      career_goals_long_term: "",
      industry_preferences: ["Fintech"],
      visa_sponsorship_required: true,
    });

    expect(argsOf().p_profile).toMatchObject({
      linkedin_url: null,
      github_url: "https://github.com/ada",
      career_goals_short_term: "Ship a design system",
      career_goals_long_term: null,
      industry_preferences: ["Fintech"],
      visa_sponsorship_required: true,
    });
  });

  it("leaves optional fields that weren't sent out, so the stored values stay", async () => {
    await run(REQUIRED);

    // undefined keys are dropped when the request is serialized.
    const sent = JSON.parse(JSON.stringify(argsOf().p_profile));
    for (const field of ["linkedin_url", "github_url", "career_goals_short_term", "max_salary"]) {
      expect(sent).not.toHaveProperty(field);
    }
  });

  it("sends an empty email when the session has none, so the stored one stays", async () => {
    await completeApplicantOnboarding({ id: USER.id }, REQUIRED, { resumeId: RESUME_ID, shouldParse: false });
    expect(argsOf().p_email).toBe("");
  });

  it.each([
    ["resume_not_found", "Resume not found."],
    ["profile_not_found", "Profile not found."],
    ["something_new", "We couldn't save your profile. Please try again."],
  ])("returns the error for %s and doesn't mark onboarding complete", async (reason, message) => {
    service = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    service.queueRpc("complete_applicant_onboarding", { data: { ok: false, reason }, error: null });

    expect(await run(REQUIRED)).toEqual({ ok: false, error: message });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing full name", { ...REQUIRED, full_name: "  " }, "full_name"],
    ["no desired roles", { ...REQUIRED, desired_roles: [] }, "desired_roles"],
    ["an unknown job type", { ...REQUIRED, job_type: ["Gig"] }, "job_type"],
    ["no locations", { ...REQUIRED, preferred_locations: [] }, "preferred_locations"],
    ["negative experience", { ...REQUIRED, experience_years: -1 }, "experience_years"],
    ["fractional experience (an integer column)", { ...REQUIRED, experience_years: 0.5 }, "experience_years"],
    ["no skills", { ...REQUIRED, top_skills: [] }, "top_skills"],
    ["no work style", { ...REQUIRED, work_style_preferences: [] }, "work_style_preferences"],
    ["no company size", { ...REQUIRED, company_size_preference: "" }, "company_size_preference"],
    ["an invalid LinkedIn URL", { ...REQUIRED, linkedin_url: "not a url" }, "linkedin_url"],
    ["max salary below min", { ...REQUIRED, max_salary: 10 }, "max_salary"],
  ])("rejects %s without writing anything", async (_label, input, field) => {
    const result = await run(input);

    expect(result).toEqual({ ok: false, error: expect.stringContaining(field) });
    expect(service.calls).toEqual([]);
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("embeds here when a resubmit queued nothing because a run is still going", async () => {
    service = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    service.queueRpc("complete_applicant_onboarding", {
      data: { ok: true, queued: false, deferred: true },
      error: null,
    });

    expect(await run(REQUIRED)).toEqual({ ok: true });
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER.id);
    expect(setUserAppMetadata).toHaveBeenCalledWith(USER.id, { onboarding_complete: true });
  });

  it("passes shouldParse through", async () => {
    await run(REQUIRED, { resumeId: RESUME_ID, shouldParse: true });
    expect(argsOf().p_should_parse).toBe(true);
  });

  it("throws database errors without marking onboarding complete", async () => {
    service = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    service.queueRpc("complete_applicant_onboarding", { data: null, error: new Error("queue down") });

    await expect(run(REQUIRED)).rejects.toThrow("queue down");
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("returns an error when the onboarding flag can't be set", async () => {
    vi.mocked(setUserAppMetadata).mockResolvedValue({ error: "Error updating user metadata." });

    expect(await run(REQUIRED)).toEqual({ ok: false, error: "Error updating user metadata." });
  });
});
