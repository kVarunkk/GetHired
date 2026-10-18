import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import type { TResumeRowContent } from "@/utils/types";
import {
  CANDIDATE_CONTEXT_MAX_CHARS,
  buildCandidateContext,
  loadCandidateContext,
} from "./candidate-context";

const section = (type: string, text: string, heading?: string) => ({
  type,
  items: [{ heading, bullets: [{ text }] }],
});

const resume: TResumeRowContent = {
  sections: [
    section("contact", "priya.sharma@example.com, +91 98765 43210"),
    section("summary", "Looking for 40 LPA, needs a visa"),
    section("experience", "Built the payments API at Razorpay. Mail priya@x.dev, see github.com/priya", "Engineer"),
    section("skills", "Go, Postgres, Kafka"),
    section("projects", "Sharma Pay: a ledger, 10k rps (linkedin.com/in/priyasharma)"),
    section("education", "B.Tech, IIT Bombay"),
    section("certifications", "AWS SA"),
  ],
};

describe("buildCandidateContext (SI-REQ-022, SI-TEST-005)", () => {
  const { firstName, context } = buildCandidateContext(resume, "Priya Sharma");

  it("keeps only experience, skills, projects and education", () => {
    expect(context).toContain("Experience:");
    expect(context).toContain("Built the payments API at Razorpay.");
    expect(context).toContain("Go, Postgres, Kafka");
    expect(context).toContain("a ledger, 10k rps");
    expect(context).toContain("B.Tech, IIT Bombay");
    expect(context).not.toContain("40 LPA");
    expect(context).not.toContain("visa");
    expect(context).not.toContain("AWS SA");
  });

  it("leaves out contact details, links and the last name", () => {
    expect(context).not.toMatch(/@/);
    expect(context).not.toContain("98765");
    expect(context).not.toContain("github.com");
    expect(context).not.toContain("linkedin");
    expect(context).not.toMatch(/sharma/i);
    expect(firstName).toBe("Priya");
  });

  it("trims to the character limit", () => {
    const long = buildCandidateContext({ sections: [section("experience", "x".repeat(20_000))] }, null);
    expect(long.context.length).toBe(CANDIDATE_CONTEXT_MAX_CHARS);
    expect(long.firstName).toBeNull();
  });
});

describe("loadCandidateContext", () => {
  const APP = "e0000000-0000-4000-8000-000000000001";
  const USER = "a0000000-0000-4000-8000-000000000001";

  it("uses the application's resume, never user_info preferences", async () => {
    const mock = createSupabaseMock();
    mock.queue("applications", { data: { resume_id: "r1", applicant_user_id: USER }, error: null });
    mock.queue("resumes", { data: { content: resume }, error: null });
    mock.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });

    const result = await loadCandidateContext(mock.client, APP);
    expect(result).toMatchObject({ ok: true, firstName: "Priya" });
    expect(mock.callsFor("resumes")[0].chain).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", "r1"] },
        { method: "eq", args: ["user_id", USER] },
      ]),
    );
    expect(mock.callsFor("user_info")[0].chain[0]).toEqual({ method: "select", args: ["full_name"] });
  });

  it("returns an error when the application has no resume", async () => {
    const mock = createSupabaseMock();
    mock.queue("applications", { data: { resume_id: null, applicant_user_id: USER }, error: null });
    expect(await loadCandidateContext(mock.client, APP)).toEqual({
      ok: false,
      error: "This application has no resume.",
    });
  });

  it("returns an error when the resume is gone", async () => {
    const mock = createSupabaseMock();
    mock.queue("applications", { data: { resume_id: "r1", applicant_user_id: USER }, error: null });
    mock.queue("resumes", { data: null, error: null });
    expect(await loadCandidateContext(mock.client, APP)).toEqual({
      ok: false,
      error: "This application has no resume.",
    });
  });
});
