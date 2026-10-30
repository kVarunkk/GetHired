import { describe, expect, it } from "vitest";
import { parseCandidateFields } from "@/helpers/candidates/candidate-schema";
import { COMPANY_A, COMPANY_B, jobPostingOf } from "./recruiter";
import { batchOf, candidateOf, importRowOf, importedApplicationOf } from "./candidates";

describe("candidate fixtures (BIT-006)", () => {
  it("makes a company candidate with a name and an email only", () => {
    const c = candidateOf(COMPANY_A);
    expect(c).toMatchObject({ company_id: COMPANY_A.id, skills: [], tags: [], resume_content: null, claimed_user_id: null });
    expect(c.email).toMatch(/@mail\.test$/);
    expect(c.id).toMatch(/^cc000000-0000-4000-8000-[0-9a-f]{12}$/);
  });

  it("gives each call its own id", () => {
    expect(candidateOf(COMPANY_A).id).not.toBe(candidateOf(COMPANY_A).id);
    expect(batchOf(COMPANY_A).id).not.toBe(batchOf(COMPANY_A).id);
  });

  it("applies overrides", () => {
    expect(candidateOf(COMPANY_B, { email: null }).email).toBeNull();
    expect(batchOf(COMPANY_A, { status: "confirmed" }).status).toBe("confirmed");
  });

  it("makes a draft spreadsheet batch", () => {
    expect(batchOf(COMPANY_A)).toMatchObject({ kind: "spreadsheet", status: "draft", duplicate_action: "skip", auto_invite: false });
  });

  it("makes a row that passes the candidate schema", () => {
    expect(parseCandidateFields(importRowOf()).ok).toBe(true);
  });

  it("makes an imported application with no applicant", () => {
    const candidate = candidateOf(COMPANY_A);
    const job = jobPostingOf(COMPANY_A);
    const app = importedApplicationOf(candidate, job);
    expect(app).toMatchObject({
      source: "imported",
      applicant_user_id: null,
      company_candidate_id: candidate.id,
      job_post_id: job.id,
      merged_into_application_id: null,
    });
  });
});
