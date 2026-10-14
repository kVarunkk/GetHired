import { describe, expect, it } from "vitest";
import {
  applicationOf,
  COMPANY_A,
  COMPANY_B,
  jobPostingOf,
  PRIVATE_APPLIED_TO_A,
  PRIVATE_NOT_APPLIED,
  PUBLIC_APPLICANT,
} from "./recruiter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("recruiter fixtures", () => {
  it("uses distinct UUIDs for every company, owner and applicant", () => {
    const ids = [
      COMPANY_A.id,
      COMPANY_B.id,
      COMPANY_A.user.id,
      COMPANY_B.user.id,
      PUBLIC_APPLICANT.id,
      PRIVATE_APPLIED_TO_A.id,
      PRIVATE_NOT_APPLIED.id,
    ];

    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes company owners company users and links them to their rows", () => {
    for (const company of [COMPANY_A, COMPANY_B]) {
      expect(company.user.app_metadata.type).toBe("company");
      expect(company.info.user_id).toBe(company.user.id);
      expect(company.infoWithTier.company_tiers.id).toBe(company.info.tier_id);
    }
  });

  it("gives applicants the sensitive columns so leaks are visible", () => {
    expect(PUBLIC_APPLICANT.info.is_public).toBe(true);
    expect(PRIVATE_APPLIED_TO_A.info.is_public).toBe(false);
    expect(PRIVATE_NOT_APPLIED.info).toMatchObject({
      is_public: false,
      ai_credits: expect.any(Number),
      referral_code: expect.any(String),
      embedding_new: expect.any(String),
    });
  });

  it("builds postings and applications with unique UUIDs and the right links", () => {
    const first = jobPostingOf(COMPANY_A);
    const second = jobPostingOf(COMPANY_B, { status: "active" });
    const application = applicationOf(PRIVATE_APPLIED_TO_A, first);

    expect(first.id).toMatch(UUID);
    expect(first.job_id).toMatch(UUID);
    expect(first.id).not.toBe(second.id);
    expect(first.company_id).toBe(COMPANY_A.id);
    expect(second).toMatchObject({ company_id: COMPANY_B.id, status: "active" });
    expect(application).toMatchObject({
      applicant_user_id: PRIVATE_APPLIED_TO_A.id,
      job_post_id: first.id,
      all_jobs_id: first.job_id,
    });
    expect(application.id).toMatch(UUID);
  });
});
