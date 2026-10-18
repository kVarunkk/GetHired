import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { getInterviewConfig, saveInterviewConfig } from "./config";

const JOB = "b0000000-0000-4000-8000-000000000001";
const COMPANY = "c0000000-0000-4000-8000-000000000001";

const stored = {
  enabled: true,
  invite_rule: "fit_threshold",
  fit_threshold: 70,
  questions: [{ text: "Why this role?" }],
  competencies: [{ name: "Communication", description: "Explains trade-offs clearly" }],
  duration_minutes: 15,
  deadline_days: 5,
  language: "en",
};

describe("getInterviewConfig", () => {
  it("returns the job's config", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_interview_configs", { data: stored, error: null });

    expect(await getInterviewConfig(mock.client, JOB)).toEqual(stored);
    expect(mock.callsFor("job_interview_configs")[0].chain).toContainEqual({
      method: "eq",
      args: ["job_post_id", JOB],
    });
  });

  it("returns null when the job has no config", async () => {
    const mock = createSupabaseMock();
    expect(await getInterviewConfig(mock.client, JOB)).toBeNull();
  });

  it("throws on a read error", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_interview_configs", { data: null, error: { message: "boom" } });
    await expect(getInterviewConfig(mock.client, JOB)).rejects.toThrow("boom");
  });
});

describe("saveInterviewConfig (SI-TEST-001)", () => {
  it("validates, upserts by job and returns the saved config", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_interview_configs", { data: stored, error: null });

    const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
      enabled: true,
      competencies: [{ name: " Communication ", description: "Explains trade-offs clearly" }],
      questions: [{ text: "Why this role?" }],
    });

    expect(result).toEqual({ ok: true, config: stored });
    const chain = mock.callsFor("job_interview_configs")[0].chain;
    const upsert = chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toEqual({
      job_post_id: JOB,
      company_id: COMPANY,
      ...stored,
    });
    expect(upsert?.args[1]).toEqual({ onConflict: "job_post_id" });
  });

  it("returns the schema's message and field", async () => {
    const mock = createSupabaseMock();
    const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
      enabled: true,
      competencies: [],
    });
    expect(result).toEqual({
      ok: false,
      field: "competencies",
      error: "Add at least one competency to turn the interview on.",
    });
    expect(mock.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it("rejects unknown keys", async () => {
    const mock = createSupabaseMock();
    const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
      enabled: false,
      company_id: "someone-else",
    });
    expect(result.ok).toBe(false);
    expect(mock.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it.each(["native English speaker", "under 30", "young and energetic"])(
    "refuses the competency %j before saving",
    async (name) => {
      const mock = createSupabaseMock();
      const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
        enabled: true,
        competencies: [{ name, description: "x" }],
      });
      expect(result).toMatchObject({ ok: false, field: "competencies.0.name" });
      expect(result.ok === false && result.error).toContain(`"${name}"`);
      expect(mock.callsFor("job_interview_configs")).toHaveLength(0);
    },
  );

  it("refuses \"culture fit\" with no description", async () => {
    const mock = createSupabaseMock();
    const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
      enabled: true,
      competencies: [{ name: "Culture fit", description: "" }],
    });
    expect(result).toMatchObject({ ok: false, field: "competencies.0.description" });
  });

  it("maps an RLS refusal to the permission copy", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_interview_configs", { data: null, error: { code: "42501", message: "rls" } });
    const result = await saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, {
      enabled: false,
    });
    expect(result).toEqual({
      ok: false,
      error: "Your role can't set up AI interviews for this job.",
    });
  });

  it("throws on other write errors", async () => {
    const mock = createSupabaseMock();
    mock.queue("job_interview_configs", { data: null, error: { code: "XX000", message: "down" } });
    await expect(
      saveInterviewConfig(mock.client, { companyId: COMPANY, jobPostId: JOB }, { enabled: false }),
    ).rejects.toThrow("down");
  });
});
