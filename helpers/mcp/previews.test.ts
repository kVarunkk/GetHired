/**
 * What MCP shows the user before a confirm tool runs (MCP TASK-063, spec
 * §4.6): read-only, no credits, and an error instead of a preview when the
 * call would fail anyway.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { previewAgentApplication } from "@/helpers/applications/preview-agent-application";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import {
  previewApplySuggestions,
  previewCompleteOnboarding,
  previewCreateResume,
  previewDeleteResume,
  previewSubmitApplication,
  previewText,
  previewUpdatePreferences,
  previewUpdateResume,
} from "./previews";

vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/applications/preview-agent-application", () => ({ previewAgentApplication: vi.fn() }));

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

let supabase: SupabaseMock;
let ctx: AgentToolContext;

const writes = () =>
  supabase.calls.filter((c) =>
    c.chain.some((step) => ["insert", "update", "upsert", "delete"].includes(step.method)),
  );

beforeEach(() => {
  supabase = createSupabaseMock();
  ctx = { ...toolContext(supabase.client), surface: "mcp", sessionId: null };
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((name) => (name === "Bangalore" ? "Bengaluru" : name)),
  );
});

describe("the resume confirmations (RE-REQ-082)", () => {
  const ROW = {
    id: RESUME_ID,
    name: "Backend",
    content: {
      version: 2,
      sections: [
        { id: "s1", type: "experience", items: [{ id: "i1", heading: "Engineer", bullets: [{ id: "b1", text: "Old" }] }] },
      ],
    },
    contact: { fullName: "Ada", links: [] },
    template: "classic",
    revision: 3,
    schema_version: 2,
  };
  const EDIT = {
    resumeId: RESUME_ID,
    expectedRevision: 3,
    operations: [{ op: "setBulletText", bulletId: "b1", text: "New" }],
  };

  it("shows an edit's before and after, and writes nothing", async () => {
    supabase.queue("resumes", { data: ROW, error: null });

    expect(await previewUpdateResume(ctx, EDIT)).toEqual({
      ok: true,
      summary: 'Change "Backend"?',
      details: [{ label: "Experience, Engineer", value: "Old → New" }],
    });
    expect(writes()).toEqual([]);
  });

  it("says 'not set' for what's new, and 'not set' isn't a blank", async () => {
    supabase.queue("resumes", { data: ROW, error: null });

    const preview = await previewUpdateResume(ctx, {
      ...EDIT,
      operations: [{ op: "addBullet", itemId: "i1", text: "Added" }],
    });

    expect(preview).toMatchObject({ ok: true, details: [{ value: "not set → Added" }] });
  });

  it("is an error for a stale revision, not a confirmation", async () => {
    supabase.queue("resumes", { data: { ...ROW, revision: 4 }, error: null });

    expect(await previewUpdateResume(ctx, EDIT)).toMatchObject({ ok: false });
  });

  it("is an error for the last resume", async () => {
    supabase.queue("resumes", { data: [ROW], error: null });

    expect(await previewDeleteResume(ctx, { resumeId: RESUME_ID })).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });

  it("is an error for an unfilled placeholder", async () => {
    supabase.queue("resume_reviews", {
      data: {
        id: JOB_ID,
        resume_id: RESUME_ID,
        ai_response: { bullet_points: [{ bullet_id: "b1", original: "Old", suggested: "Cut by [X%]" }] },
      },
      error: null,
    });

    const preview = await previewApplySuggestions(ctx, { reviewId: JOB_ID, items: [{ id: "b1" }] });

    expect(preview).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });

  it("names a new resume's sections", async () => {
    supabase.queue("resumes", { data: null, error: null, count: 1 });

    expect(await previewCreateResume(ctx, { name: "Design" })).toMatchObject({
      ok: true,
      summary: 'Create the resume "Design"? It starts empty.',
    });
  });
});

describe("previewText", () => {
  it("is the summary, then one line per detail", () => {
    expect(
      previewText({
        ok: true,
        summary: "Do it?",
        details: [
          { label: "A", value: "1" },
          { label: "B", value: "2" },
        ],
      }),
    ).toBe("Do it?\n- A: 1\n- B: 2");
  });
});

describe("previewSubmitApplication", () => {
  it("shows the job, the resume and each answer under its own label, with the cost", async () => {
    vi.mocked(previewAgentApplication).mockResolvedValue({
      ok: true,
      job: { title: "Frontend Engineer", company: "Acme" },
      resume: "Ada CV",
      answers: [
        { key: "q1", label: "Why us?", text: "I like your product." },
        { key: "q2", label: "Portfolio", text: null },
      ],
    });
    const input = { jobId: JOB_ID, answers: [{ key: "q1", value: "I like your product." }] };

    const preview = await previewSubmitApplication(ctx, input);

    expect(previewAgentApplication).toHaveBeenCalledWith(supabase.client, ctx.user, input);
    expect(preview).toEqual({
      ok: true,
      summary: "Send this application? It uses 1 AI credit, and the company sees these answers.",
      details: [
        { label: "Job", value: "Frontend Engineer at Acme" },
        { label: "Resume", value: "Ada CV" },
        { label: "Why us?", value: "I like your product." },
        { label: "Portfolio", value: "no answer" },
      ],
    });
  });

  it("passes on what's wrong with the application, field by field", async () => {
    vi.mocked(previewAgentApplication).mockResolvedValue({
      ok: false,
      error: "Some answers need fixing.",
      fieldErrors: [{ label: "Why us?", error: "This field is required." }],
    });

    expect(await previewSubmitApplication(ctx, { jobId: JOB_ID, answers: [] })).toEqual({
      ok: false,
      error: "Some answers need fixing. Why us?: This field is required.",
    });
  });
});

describe("previewUpdatePreferences", () => {
  it("shows each changed field before and after, with locations as they'll be saved", async () => {
    supabase.queue("user_info", {
      data: { preferred_locations: ["Remote"], min_salary: null, visa_sponsorship_required: false },
      error: null,
    });

    const preview = await previewUpdatePreferences(ctx, {
      preferredLocations: ["Bangalore", "Remote"],
      minSalary: 1200000,
      visaSponsorshipRequired: true,
    });

    expect(preview).toEqual({
      ok: true,
      summary: "Update your job preferences?",
      details: [
        { label: "Preferred locations", value: "Remote → Bengaluru, Remote" },
        { label: "Minimum salary", value: "not set → 1200000" },
        { label: "Visa sponsorship required", value: "No → Yes" },
      ],
    });
    const select = supabase.callsFor("user_info")[0].chain;
    expect(select).toContainEqual({
      method: "select",
      args: ["preferred_locations, min_salary, visa_sponsorship_required"],
    });
    expect(select).toContainEqual({ method: "eq", args: ["user_id", ctx.user.id] });
    expect(writes()).toEqual([]);
  });

  it("refuses when the user has no profile yet", async () => {
    supabase.queue("user_info", { data: null, error: null });

    expect(await previewUpdatePreferences(ctx, { desiredRoles: ["Designer"] })).toEqual({
      ok: false,
      error: "Profile not found. Ask the user to complete onboarding with complete_onboarding.",
    });
  });
});

describe("previewCompleteOnboarding", () => {
  const input = {
    fullName: "Ada Lovelace",
    desiredRoles: ["Frontend Engineer"],
    jobTypes: ["Fulltime"],
    salaryCurrency: "$",
    minSalary: 100000,
    preferredLocations: ["Bangalore"],
    experienceYears: 4,
    topSkills: ["React", "TypeScript"],
    workStylePreferences: ["Remote"],
    companySizePreference: "Small (1-50)",
  };

  it("lists the fields it will save and the resume it will use", async () => {
    supabase.queue("user_info", { data: { filled: false }, error: null });
    supabase.queue("resumes", { data: { name: "Ada CV", content: "…", parsing_failed: false }, error: null });

    const preview = await previewCompleteOnboarding(ctx, input);

    expect(preview).toEqual({
      ok: true,
      summary: "Set up your profile with these details?",
      details: [
        { label: "Full name", value: "Ada Lovelace" },
        { label: "Desired roles", value: "Frontend Engineer" },
        { label: "Job types", value: "Fulltime" },
        { label: "Salary currency", value: "$" },
        { label: "Minimum salary", value: "100000" },
        { label: "Preferred locations", value: "Bengaluru" },
        { label: "Years of experience", value: "4" },
        { label: "Top skills", value: "React, TypeScript" },
        { label: "Work style", value: "Remote" },
        { label: "Company size", value: "Small (1-50)" },
        { label: "Resume", value: "Ada CV" },
      ],
    });
    // No resumeId: the primary resume, as the tool picks it.
    expect(supabase.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["is_primary", true] });
    expect(writes()).toEqual([]);
  });

  it("uses the chosen resume", async () => {
    supabase.queue("user_info", { data: { filled: false }, error: null });
    supabase.queue("resumes", { data: { name: "Other CV", content: "…", parsing_failed: false }, error: null });

    await previewCompleteOnboarding(ctx, { ...input, resumeId: RESUME_ID });

    expect(supabase.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["id", RESUME_ID] });
  });

  it("refuses a user who's already onboarded", async () => {
    supabase.queue("user_info", { data: { filled: true }, error: null });

    expect(await previewCompleteOnboarding(ctx, input)).toEqual({
      ok: false,
      error: "The user is already onboarded. Use update_my_preferences to change their profile.",
    });
  });

  it("refuses without a resume, and says where to upload one", async () => {
    supabase.queue("user_info", { data: { filled: false }, error: null });
    supabase.queue("resumes", { data: null, error: null });

    expect(await previewCompleteOnboarding(ctx, input)).toEqual({
      ok: false,
      error:
        "Onboarding needs a resume. The user can upload one at http://localhost:3000/resume, then call this tool again with its resumeId.",
    });
  });
});
