import { describe, expect, it } from "vitest";
import { reviewTarget, reviewTargetText } from "./target";

const row = { job_id: null, target_jd: null, focus: null, all_jobs: null };

describe("reviewTarget", () => {
  it("reads the job, a pasted description and the focus", () => {
    expect(reviewTarget({ ...row, job_id: "j1", target_jd: "x", all_jobs: { job_name: "AI Engineer", company_name: "Acme" } })).toEqual({
      job: { id: "j1", title: "AI Engineer", company: "Acme" },
      pastedJob: false,
      focus: null,
    });
    expect(reviewTarget({ ...row, target_jd: "Build agents.", focus: "  " })).toEqual({ job: null, pastedJob: true, focus: null });
  });
});

describe("reviewTargetText", () => {
  it("names what the review was for", () => {
    const job = { id: "j1", title: "AI Engineer", company: "Acme" };
    expect(reviewTargetText({ job, pastedJob: false, focus: null })).toBe("Tailored for the job AI Engineer at Acme (/jobs/j1).");
    expect(reviewTargetText({ job: null, pastedJob: true, focus: "shorter" })).toBe(
      'Tailored for the job description the user pasted, with the focus "shorter".',
    );
    expect(reviewTargetText({ job: null, pastedJob: false, focus: "AI engineer roles" })).toBe(
      'No job: reviewed for "AI engineer roles".',
    );
    expect(reviewTargetText({ job: null, pastedJob: false, focus: null })).toMatch(/on its own/);
  });
});
