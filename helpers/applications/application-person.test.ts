import { describe, expect, it } from "vitest";
import { applicationPerson, applicationPersonOrNull, COMPANY_CANDIDATE_PERSON_COLUMNS } from "./application-person";

const USER_ID = "a0000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "cc000000-0000-4000-8000-000000000001";

describe("applicationPerson (BI-REQ-030)", () => {
  it("reads a GetHired applicant from user_info", () => {
    expect(
      applicationPerson({
        applicant_user_id: USER_ID,
        company_candidate_id: null,
        user_info: { full_name: "Ada Lovelace", email: "ada@example.com" },
        company_candidates: null,
      }),
    ).toEqual({
      kind: "user",
      id: USER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      href: `/company/profiles/${USER_ID}`,
      imported: false,
      hasResume: true,
    });
  });

  it("reads a company candidate", () => {
    expect(
      applicationPerson({
        applicant_user_id: null,
        company_candidate_id: CANDIDATE_ID,
        user_info: null,
        company_candidates: { id: CANDIDATE_ID, full_name: "Asha Rao", email: "asha@mail.test", resume_path: null },
      }),
    ).toEqual({
      kind: "candidate",
      id: CANDIDATE_ID,
      name: "Asha Rao",
      email: "asha@mail.test",
      href: `/company/candidates/${CANDIDATE_ID}`,
      imported: true,
      hasResume: false,
    });
  });

  it("knows a candidate's resume from its file or its parsed content", () => {
    const base = { applicant_user_id: null, company_candidate_id: CANDIDATE_ID, user_info: null };
    expect(
      applicationPerson({ ...base, company_candidates: { id: CANDIDATE_ID, full_name: "A", email: null, resume_path: "c/b/x.pdf" } })
        .hasResume,
    ).toBe(true);
    expect(
      applicationPerson({
        ...base,
        company_candidates: { id: CANDIDATE_ID, full_name: "A", email: null, resume_content: { sections: [] } },
      }).hasResume,
    ).toBe(true);
  });

  it("reads a claimed candidate (both set) from the company's record, with the account connected (BIT-101)", () => {
    expect(
      applicationPerson({
        applicant_user_id: USER_ID,
        company_candidate_id: CANDIDATE_ID,
        user_info: { full_name: "Ada Lovelace", email: "ada@example.com" },
        company_candidates: { id: CANDIDATE_ID, full_name: "Ada L.", email: "ada@mail.test", resume_path: "c/b/x.pdf" },
      }),
    ).toEqual({
      kind: "candidate",
      id: CANDIDATE_ID,
      name: "Ada L.",
      email: "ada@mail.test",
      href: `/company/candidates/${CANDIDATE_ID}`,
      imported: true,
      hasResume: true,
      connectedUserId: USER_ID,
    });
  });

  it("takes a claimed candidate's resume from the import, not the account", () => {
    const person = applicationPerson({
      applicant_user_id: USER_ID,
      company_candidate_id: CANDIDATE_ID,
      user_info: { full_name: "Ada Lovelace" },
      company_candidates: { id: CANDIDATE_ID, full_name: "Ada L.", email: null, resume_path: null },
    });
    expect(person).toMatchObject({ hasResume: false, connectedUserId: USER_ID });
    expect(person).not.toHaveProperty("email");
  });

  it("connects no account to an unclaimed candidate or a direct applicant", () => {
    expect(
      applicationPerson({
        applicant_user_id: null,
        company_candidate_id: CANDIDATE_ID,
        company_candidates: { id: CANDIDATE_ID, full_name: "Asha Rao" },
      }),
    ).not.toHaveProperty("connectedUserId");
    expect(applicationPerson({ applicant_user_id: USER_ID, user_info: { full_name: "Ada" } })).not.toHaveProperty(
      "connectedUserId",
    );
  });

  it("falls back to a generic name when the profile is hidden", () => {
    expect(
      applicationPerson({ applicant_user_id: USER_ID, company_candidate_id: null, user_info: null }).name,
    ).toBe("Applicant");
  });

  it("throws for a row with neither", () => {
    expect(() => applicationPerson({ applicant_user_id: null, company_candidate_id: null })).toThrow();
  });

  it("names the candidate columns the readers select", () => {
    expect(COMPANY_CANDIDATE_PERSON_COLUMNS).toBe("company_candidates(id, full_name, email, resume_path)");
  });
});

describe("applicationPersonOrNull", () => {
  it("is null instead of throwing for a row with neither", () => {
    expect(applicationPersonOrNull({ applicant_user_id: null, company_candidate_id: null })).toBeNull();
    expect(applicationPersonOrNull({ applicant_user_id: USER_ID, user_info: { full_name: "Ada" } })?.name).toBe("Ada");
  });
});
