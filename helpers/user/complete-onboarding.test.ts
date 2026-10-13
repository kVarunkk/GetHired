import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { completeApplicantOnboarding } from "./complete-onboarding";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/user/set-app-metadata", () => ({ setUserAppMetadata: vi.fn() }));

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

let supabase: SupabaseMock;
let service: SupabaseMock;

const run = (input: unknown, options = { resumeId: RESUME_ID, shouldParse: false }) =>
  completeApplicantOnboarding(supabase.client, USER, input, options);

/** The `user_info` update: its values, then the rest of the chain. */
const updateOf = () => supabase.callsFor("user_info").find((c) => c.chain[0].method === "update")?.chain;

beforeEach(() => {
  supabase = createSupabaseMock();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null });
  supabase.queue("resumes", { data: { id: RESUME_ID }, error: null }); // ownership check
  supabase.queue("user_info", { data: [{ user_id: USER.id }], error: null }); // profile update
});

describe("completeApplicantOnboarding", () => {
  it("saves the profile, sets the primary resume, queues the pipeline and marks onboarding complete", async () => {
    const result = await run({ ...REQUIRED, max_salary: 2500000 });

    expect(result).toEqual({ ok: true });

    // SEC-010: the resume must be the user's.
    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id"] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "eq", args: ["user_id", USER.id] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("resumes")[1].chain).toEqual([
      { method: "update", args: [{ is_primary: false }] },
      { method: "eq", args: ["user_id", USER.id] },
    ]);
    expect(supabase.callsFor("resumes")[2].chain).toEqual([
      { method: "update", args: [{ is_primary: true }] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "eq", args: ["user_id", USER.id] },
    ]);

    // An update of the row sign-up created: never an insert.
    expect(updateOf()).toEqual([
      {
        method: "update",
        args: [
          {
            ...REQUIRED,
            max_salary: 2500000,
            email: USER.email,
            filled: true,
            // Queued, not processed yet: the jobs page shows matches as being generated.
            relevant_jobs_update_status: "progress",
            updated_at: expect.any(String),
          },
        ],
      },
      { method: "eq", args: ["user_id", USER.id] },
      { method: "select", args: ["user_id"] },
    ]);

    const send = service.calls.find((c) => c.kind === "rpc" && c.target === "send");
    expect(send?.schema).toBe("pgmq_public");
    expect(send?.chain[0].args[1]).toEqual({
      queue_name: "onboarding_pipeline",
      message: { userId: USER.id, resumeId: RESUME_ID, shouldParse: false },
    });

    // Only the flag: the account type is set at sign-up and never changed here.
    expect(setUserAppMetadata).toHaveBeenCalledWith(USER.id, { onboarding_complete: true });
  });

  it("writes only allowlisted columns, whatever the input contains (SEC-009)", async () => {
    await run({ ...REQUIRED, user_id: "someone-else", ai_credits: 9999, filled: false, email: "x@y.z" });

    const chain = updateOf()!;
    const values = chain[0].args[0];
    expect(values).toMatchObject({ email: USER.email, filled: true });
    expect(values).not.toHaveProperty("ai_credits");
    expect(values).not.toHaveProperty("user_id");
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
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

    expect(updateOf()![0].args[0]).toMatchObject({
      linkedin_url: null,
      github_url: "https://github.com/ada",
      career_goals_short_term: "Ship a design system",
      career_goals_long_term: null,
      industry_preferences: ["Fintech"],
      visa_sponsorship_required: true,
    });
  });

  it("leaves optional fields that weren't sent untouched", async () => {
    await run(REQUIRED);

    const values = updateOf()![0].args[0] as Record<string, unknown>;
    for (const field of ["linkedin_url", "github_url", "career_goals_short_term", "max_salary"]) {
      expect(values).not.toHaveProperty(field);
    }
  });

  it("returns an error when the user has no profile row", async () => {
    supabase = createSupabaseMock();
    supabase.queue("resumes", { data: { id: RESUME_ID }, error: null });
    supabase.queue("user_info", { data: [], error: null });

    expect(await run(REQUIRED)).toEqual({ ok: false, error: "Profile not found." });
    // Nothing else changed: the primary resume is untouched.
    expect(supabase.callsFor("resumes")).toHaveLength(1);
    expect(service.calls).toEqual([]);
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing full name", { ...REQUIRED, full_name: "  " }, "full_name"],
    ["no desired roles", { ...REQUIRED, desired_roles: [] }, "desired_roles"],
    ["an unknown job type", { ...REQUIRED, job_type: ["Gig"] }, "job_type"],
    ["no locations", { ...REQUIRED, preferred_locations: [] }, "preferred_locations"],
    ["negative experience", { ...REQUIRED, experience_years: -1 }, "experience_years"],
    ["no skills", { ...REQUIRED, top_skills: [] }, "top_skills"],
    ["no work style", { ...REQUIRED, work_style_preferences: [] }, "work_style_preferences"],
    ["no company size", { ...REQUIRED, company_size_preference: "" }, "company_size_preference"],
    ["an invalid LinkedIn URL", { ...REQUIRED, linkedin_url: "not a url" }, "linkedin_url"],
    ["max salary below min", { ...REQUIRED, max_salary: 10 }, "max_salary"],
  ])("rejects %s without writing anything", async (_label, input, field) => {
    const result = await run(input);

    expect(result).toEqual({ ok: false, error: expect.stringContaining(field) });
    expect(supabase.calls).toEqual([]);
    expect(service.calls).toEqual([]);
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("rejects a resume that isn't the user's (SEC-010)", async () => {
    supabase = createSupabaseMock();
    supabase.queue("resumes", { data: null, error: null });

    expect(await run(REQUIRED)).toEqual({ ok: false, error: "Resume not found." });
    expect(supabase.callsFor("user_info")).toHaveLength(0);
    expect(service.calls).toEqual([]);
  });

  it("passes shouldParse through for a freshly uploaded file", async () => {
    await run(REQUIRED, { resumeId: RESUME_ID, shouldParse: true });

    const send = service.calls.find((c) => c.target === "send");
    expect(send?.chain[0].args[1]).toMatchObject({ message: { shouldParse: true } });
  });

  it("rolls back to not-onboarded when the pipeline can't be queued, so onboarding can be retried", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue({
      ...service.client,
      schema: () => ({ rpc: () => Promise.resolve({ error: new Error("queue down") }) }),
    } as never);

    await expect(run(REQUIRED)).rejects.toThrow("queue down");

    const statusUpdates = supabase
      .callsFor("user_info")
      .map((c) => c.chain)
      .filter((chain) => chain[0].method === "update");
    expect(statusUpdates.at(-1)).toEqual([
      { method: "update", args: [{ filled: false, relevant_jobs_update_status: "pending" }] },
      { method: "eq", args: ["user_id", USER.id] },
    ]);
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("returns an error when the onboarding flag can't be set", async () => {
    vi.mocked(setUserAppMetadata).mockResolvedValue({ error: "Error updating user metadata." });

    expect(await run(REQUIRED)).toEqual({ ok: false, error: "Error updating user metadata." });
  });

  it("throws database errors", async () => {
    supabase = createSupabaseMock();
    supabase.queue("resumes", { data: { id: RESUME_ID }, error: null });
    supabase.queue("user_info", { data: null, error: new Error("update failed") });

    await expect(run(REQUIRED)).rejects.toThrow("update failed");
  });
});
