import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// JPT-043 / JP-SEC-003: `job_postings` is world-readable, and a job's
// `pipeline_id` is a company setting. The surfaces applicants, the public,
// the applicant MCP tools and the extension read never select it, and never
// return a whole job_postings row (`select("*")`), which would carry it.

/** What applicants, the public, applicant MCP and the extension read jobs through. */
const SURFACES = [
  "helpers/agent/tools", // the applicant agent's tools, which applicant MCP runs
  "helpers/careers",
  "app/careers",
  "app/jobs",
  "app/api/careers",
  "app/api/jobs",
];
const FILES = [
  "app/api/job-posting/route.ts",
  "helpers/mcp/tools.ts",
  "helpers/mcp/server.ts",
  "helpers/jobs/search-jobs.ts",
  "helpers/jobs/parse-job-query.ts",
  "helpers/jobs/load-job-form.ts",
  "helpers/jobs/public-application-form.ts",
];

/**
 * Applicant-reachable files that name `pipeline_id`, and why that's safe.
 */
const ALLOWED: Record<string, string> = {
  // Reads it with the service role to move a knockout reject into the job's
  // pipeline; it never reaches the applicant.
  "helpers/applications/submit-application.ts": "server-side knockout move only",
  // Reads the whole row but strips pipeline_id from the response (its route.test.ts).
  "app/api/job-posting/route.ts": "removes pipeline_id from the response",
};

const surfaceFiles = () => [...sourceFiles(SURFACES), ...FILES];

const SELECT_STAR_JOBS = /from\(\s*["'`]job_postings["'`]\s*\)\s*\.select\(\s*(["'`]\*["'`])?\s*\)/;

describe("applicants never see a job's pipeline (JPT-043, JP-SEC-003)", () => {
  it("the applicant, public, MCP and careers job reads don't name pipeline_id", () => {
    const offenders = surfaceFiles().filter((file) => !ALLOWED[file] && readSource(file).includes("pipeline_id"));
    expect(offenders).toEqual([]);
  });

  it("they don't return whole job_postings rows either", () => {
    const offenders = surfaceFiles().filter((file) => !ALLOWED[file] && SELECT_STAR_JOBS.test(readSource(file)));
    expect(offenders).toEqual([]);
  });

  it("the allowed files still need their exception", () => {
    for (const file of Object.keys(ALLOWED)) expect(readSource(file), file).toContain("pipeline_id");
  });

  it("the careers RPCs list their columns instead of a whole job row", () => {
    const sql = readSource("supabase/migrations/20261017230000_careers_page.sql");
    expect(sql).toContain("function public.get_careers_jobs");
    expect(sql).not.toMatch(/pipeline_id/);
    expect(sql).not.toMatch(/to_jsonb\(\s*j\s*\)|row_to_json\(\s*j\s*\)|\bj\.\*/);
  });

  it("the pattern catches a whole-row read", () => {
    expect(SELECT_STAR_JOBS.test(`supabase.from("job_postings").select("*")`)).toBe(true);
    expect(SELECT_STAR_JOBS.test(`supabase.from("job_postings").select()`)).toBe(true);
    expect(SELECT_STAR_JOBS.test(`supabase.from("job_postings").select("id, title")`)).toBe(false);
  });
});
