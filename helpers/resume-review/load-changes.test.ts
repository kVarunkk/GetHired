import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { loadResumeChanges } from "./load-changes";

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const COPY_ID = "33333333-3333-4333-8333-333333333333";

const resume = (id: string, b1 = "Worked on billing") => ({
  id,
  name: "Backend",
  template: "classic",
  revision: 2,
  schema_version: 2,
  contact: { fullName: "Ada", links: [] },
  content: {
    version: 2,
    sections: [
      {
        id: "s1",
        type: "experience",
        items: [{ id: "i1", bullets: [{ id: "b1", text: b1 }, { id: "b2", text: "Helped with tests" }] }],
      },
    ],
  },
});

const REVIEW = {
  id: REVIEW_ID,
  resume_id: SOURCE_ID,
  applied_copy_id: null as string | null,
  job_id: "j1" as string | null,
  target_jd: "Build agents." as string | null,
  focus: null as string | null,
  all_jobs: { job_name: "AI Engineer", company_name: "Acme" } as { job_name: string | null; company_name: string | null } | null,
  resume_review_applied: [] as { bullet_id: string; target_resume_id: string; previous_text: string; applied_text: string }[],
  ai_response: {
    overall_feedback: "Solid, but vague.",
    bullet_points: [
      { bullet_id: "b1", section: "x", original: "Worked on billing", suggested: "Built billing", reason: "r", priority: "high" },
    ],
    changes: [
      { kind: "add", id: "add-1", item_id: "i1", anchors: ["b1"], suggested: "Led [N] people", reason: "r", priority: "low" },
    ],
    gaps: [{ requirement: "Go", question: "Have you used Go?" }],
  },
};

let db: SupabaseMock;

const load = () => loadResumeChanges(db.client, USER, REVIEW_ID);

beforeEach(() => {
  db = createSupabaseMock();
});

describe("loadResumeChanges (RI-REQ-023)", () => {
  it("returns the changes, the gaps and the summary", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: [resume(SOURCE_ID)], error: null });

    const result = await load();

    expect(result).toMatchObject({ ok: true, summary: "Solid, but vague.", resumeName: "Backend", gaps: REVIEW.ai_response.gaps });
    expect(result.ok && result.changes.map(({ id }) => id)).toEqual(["b1", "add-1"]);
    expect(result.ok && result.original.states).toEqual({ b1: "pending", "add-1": "pending" });
    expect(result.ok && result.target).toEqual({
      job: { id: "j1", title: "AI Engineer", company: "Acme" },
      pastedJob: false,
      focus: null,
    });
  });

  it("reads a review without a job as aimed at its focus", async () => {
    db.queue("resume_reviews", {
      data: { ...REVIEW, job_id: null, target_jd: null, all_jobs: null, focus: "AI engineer roles" },
      error: null,
    });
    db.queue("resumes", { data: [resume(SOURCE_ID)], error: null });

    const result = await load();

    expect(result.ok && result.target).toEqual({ job: null, pastedJob: false, focus: "AI engineer roles" });
  });

  it("has no copy id until a copy exists, and starts it from the original (RI-REQ-028)", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: [resume(SOURCE_ID)], error: null });

    const result = await load();

    expect(result.ok && result.copy.resumeId).toBeNull();
    expect(result.ok && result.copy.content).toEqual(result.ok && result.original.content);
  });

  it("gives each target its own states", async () => {
    db.queue("resume_reviews", {
      data: {
        ...REVIEW,
        applied_copy_id: COPY_ID,
        resume_review_applied: [
          { bullet_id: "b1", target_resume_id: COPY_ID, previous_text: "Worked on billing", applied_text: "Built billing" },
          { bullet_id: "add-1", target_resume_id: COPY_ID, previous_text: "", applied_text: "Cut costs" },
        ],
      },
      error: null,
    });
    db.queue("resumes", { data: [resume(SOURCE_ID), resume(COPY_ID, "Built billing")], error: null });

    const result = await load();

    expect(result.ok && result.copy.states).toEqual({ b1: "applied", "add-1": "applied" });
    expect(result.ok && result.original.states).toEqual({ b1: "pending", "add-1": "pending" });
    expect(result.ok && result.copy.applied.b1).toEqual({ previous: "Worked on billing", text: "Built billing" });
    expect(result.ok && result.original.applied).toEqual({});
  });

  it("marks a change the resume moved past", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: [resume(SOURCE_ID, "Something new")], error: null });

    const result = await load();

    expect(result.ok && result.original.states.b1).toBe("changed");
  });

  it("reads an older review, with only rewrites and no gaps", async () => {
    db.queue("resume_reviews", {
      data: { ...REVIEW, ai_response: { bullet_points: REVIEW.ai_response.bullet_points } },
      error: null,
    });
    db.queue("resumes", { data: [resume(SOURCE_ID)], error: null });

    const result = await load();

    expect(result).toMatchObject({ ok: true, summary: "", gaps: [] });
    expect(result.ok && result.changes).toHaveLength(1);
  });

  it("is scoped to the user (RI-SEC-001)", async () => {
    db.queue("resume_reviews", { data: REVIEW, error: null });
    db.queue("resumes", { data: [resume(SOURCE_ID)], error: null });

    await load();

    expect(db.callsFor("resume_reviews")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });

  it("says so for another user's review, or a deleted resume", async () => {
    db.queue("resume_reviews", { data: null, error: null });
    expect(await load()).toMatchObject({ ok: false });

    db.queue("resume_reviews", { data: { ...REVIEW, resume_id: null }, error: null });
    expect(await load()).toMatchObject({ ok: false });
  });
});
