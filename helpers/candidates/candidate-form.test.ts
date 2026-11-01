import { describe, expect, it } from "vitest";
import { COMPANY_A } from "@/test/utils/recruiter";
import { candidateOf } from "@/test/utils/candidates";
import { candidateFieldsSchema } from "./candidate-schema";
import { candidateFormValues, changedFields, EMPTY_CANDIDATE_FORM } from "./candidate-form";

const candidate = candidateOf(COMPANY_A, {
  full_name: "Meera Iyer",
  email: "meera@mail.test",
  experience_years: 0,
  links: { linkedin: "https://linkedin.com/in/meera", github: 42 },
  skills: ["Go", "Rust"],
  tags: ["referral"],
});

describe("candidateFormValues (BI-REQ-004)", () => {
  it("turns a stored candidate into the inputs' text", () => {
    expect(candidateFormValues(candidate)).toEqual({
      ...EMPTY_CANDIDATE_FORM,
      full_name: "Meera Iyer",
      email: "meera@mail.test",
      experience_years: "0",
      linkedin_url: "https://linkedin.com/in/meera",
      skills: "Go, Rust",
      tags: "referral",
    });
  });

  it("reads back through the import's schema unchanged", () => {
    const parsed = candidateFieldsSchema.parse(candidateFormValues(candidate));
    expect(parsed).toMatchObject({ experience_years: 0, skills: ["Go", "Rust"], github_url: null });
  });
});

describe("changedFields", () => {
  it("keeps only what changed, including a field cleared", () => {
    const initial = candidateFormValues(candidate);
    expect(changedFields(initial, { ...initial, phone: "+91 98765", tags: "", full_name: " Meera Iyer " })).toEqual({
      phone: "+91 98765",
      tags: "",
    });
    expect(changedFields(initial, initial)).toEqual({});
  });
});
