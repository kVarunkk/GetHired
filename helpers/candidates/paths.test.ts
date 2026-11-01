import { describe, expect, it } from "vitest";
import { candidateImportPath, IMPORT_METHODS, isImportMethod, jobImportPath } from "./paths";

const JOB = "b0000000-0000-4000-8000-0000000000a1";

describe("import paths (CP-REQ-032, CP-DEC-004)", () => {
  it("builds a job's import path, resumes by default", () => {
    expect(jobImportPath(JOB)).toBe(`/company/job-posts/${JOB}/import/resumes`);
    expect(jobImportPath(JOB, "spreadsheet")).toBe(`/company/job-posts/${JOB}/import/spreadsheet`);
    expect(jobImportPath(JOB, "form")).toBe(`/company/job-posts/${JOB}/import/form`);
  });

  it("builds the Candidates page's import path, resumes by default", () => {
    expect(candidateImportPath()).toBe("/company/candidates/import/resumes");
    expect(candidateImportPath("spreadsheet")).toBe("/company/candidates/import/spreadsheet");
    // @ts-expect-error The Candidates page's form is /company/candidates/new.
    candidateImportPath("form");
  });

  it("knows the three methods and refuses anything else", () => {
    expect(IMPORT_METHODS).toEqual(["resumes", "spreadsheet", "form"]);
    expect(IMPORT_METHODS.every(isImportMethod)).toBe(true);
    expect(isImportMethod("csv")).toBe(false);
    expect(isImportMethod(undefined)).toBe(false);
  });
});
