import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import type { TResumeRowContent } from "@/utils/types";
import {
  CANDIDATE_CONTEXT_MAX_CHARS,
  buildCandidateContext,
  buildShortCandidateContext,
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

  it("builds the short context with only what's there (BIT-103)", () => {
    expect(
      buildShortCandidateContext(
        { current_title: null, current_company: "Sharma Labs", experience_years: 1, skills: null },
        "Priya Sharma",
      ),
    ).toEqual({ firstName: "Priya", context: "Experience:\n[removed] Labs, 1 year of experience" });
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

  it("prefers what the application sent, and never reads its contact details (RE-REQ-062)", async () => {
    const mock = createSupabaseMock();
    const content = {
      version: 2,
      sections: [{ id: "s1", type: "skills", items: [{ id: "i1", bullets: [{ id: "b1", text: "Sent text" }] }] }],
    };
    mock.queue("applications", {
      data: { resume_id: "r1", applicant_user_id: USER, resume_snapshot: { name: "x", template: "classic", content } },
      error: null,
    });
    mock.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });

    const result = await loadCandidateContext(mock.client, APP);

    expect(result).toMatchObject({ ok: true, firstName: "Priya" });
    expect(result).toMatchObject({ context: expect.stringContaining("Sent text") });
    expect(mock.callsFor("resumes")).toHaveLength(0);
    expect(String(mock.callsFor("applications")[0].chain[0].args[0])).not.toContain("contact");
  });

  it("uses the snapshot even when the resume it came from was deleted", async () => {
    const mock = createSupabaseMock();
    mock.queue("applications", {
      data: {
        resume_id: null,
        applicant_user_id: USER,
        resume_snapshot: { name: "x", template: "classic", content: { version: 2, sections: [] } },
      },
      error: null,
    });
    mock.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });

    expect(await loadCandidateContext(mock.client, APP)).toMatchObject({ ok: true });
  });

  it("returns an error when the application has no resume", async () => {
    const mock = createSupabaseMock();
    mock.queue("applications", { data: { resume_id: null, applicant_user_id: USER }, error: null });
    expect(await loadCandidateContext(mock.client, APP)).toEqual({
      ok: false,
      error: "This application has no resume.",
    });
  });

  describe("a claimed import (BIT-103)", () => {
    const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
    const claimed = { resume_id: null, applicant_user_id: USER, company_candidate_id: CANDIDATE };
    const candidateRow = (overrides: Record<string, unknown> = {}) => ({
      full_name: "Priya Sharma",
      current_title: null,
      current_company: null,
      experience_years: null,
      skills: [],
      resume_content: null,
      ...overrides,
    });

    it("uses the company's resume, scrubbed, with no contact columns read", async () => {
      const mock = createSupabaseMock();
      mock.queue("applications", { data: claimed, error: null });
      mock.queue("company_candidates", { data: candidateRow({ resume_content: resume }), error: null });

      const result = await loadCandidateContext(mock.client, APP);

      expect(result).toMatchObject({ ok: true, firstName: "Priya" });
      const { context } = result as { context: string };
      expect(context).toContain("Built the payments API at Razorpay.");
      expect(context).not.toMatch(/@|sharma|github\.com|40 LPA/i);
      expect(mock.callsFor("resumes")).toHaveLength(0);
      expect(mock.callsFor("user_info")).toHaveLength(0);
      const select = mock.callsFor("company_candidates")[0].chain[0];
      expect(select.method).toBe("select");
      expect(select.args[0]).not.toMatch(/email|phone|tags|notes|links/);
      expect(mock.callsFor("company_candidates")[0].chain).toContainEqual({ method: "eq", args: ["id", CANDIDATE] });
    });

    it("builds a short context from title, company, years and skills without a resume", async () => {
      const mock = createSupabaseMock();
      mock.queue("applications", { data: claimed, error: null });
      mock.queue("company_candidates", {
        data: candidateRow({
          current_title: "Backend Engineer",
          current_company: "Razorpay",
          experience_years: 5,
          skills: ["Go", " Postgres ", ""],
        }),
        error: null,
      });

      expect(await loadCandidateContext(mock.client, APP)).toEqual({
        ok: true,
        firstName: "Priya",
        context: "Experience:\nBackend Engineer at Razorpay, 5 years of experience\n\nSkills:\nGo, Postgres",
      });
    });

    it("returns an error when the record has nothing to go on", async () => {
      const mock = createSupabaseMock();
      mock.queue("applications", { data: claimed, error: null });
      mock.queue("company_candidates", { data: candidateRow(), error: null });

      expect(await loadCandidateContext(mock.client, APP)).toEqual({ ok: false, error: "This application has no resume." });
    });

    it("prefers the application's own resume when there is one", async () => {
      const mock = createSupabaseMock();
      mock.queue("applications", { data: { ...claimed, resume_id: "r1" }, error: null });
      mock.queue("resumes", { data: { content: resume }, error: null });
      mock.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });

      expect(await loadCandidateContext(mock.client, APP)).toMatchObject({ ok: true });
      expect(mock.callsFor("company_candidates")).toHaveLength(0);
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
