import { describe, expect, it } from "vitest";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { prefillStandardAnswers } from "./prefill";
import { standardAnswerKey } from "./validate-answers";

const PROFILE = {
  linkedin_url: "https://linkedin.com/in/ada",
  github_url: "https://github.com/ada",
  preferred_locations: ["", "Bengaluru"],
  min_salary: 1500000,
  salary_currency: "inr",
};

const formWith = (standard_fields: ApplicationForm["standard_fields"]): ApplicationForm => ({
  version: 1,
  questions: [],
  standard_fields,
});

describe("prefillStandardAnswers (AF-REQ-002)", () => {
  it("prefills the standard fields the job asks for", () => {
    const form = formWith({
      linkedin_url: "required",
      portfolio_url: "optional",
      current_location: "optional",
      expected_salary: "required",
    });
    expect(prefillStandardAnswers(form, PROFILE)).toEqual({
      [standardAnswerKey("linkedin_url")]: "https://linkedin.com/in/ada",
      [standardAnswerKey("portfolio_url")]: "https://github.com/ada",
      [standardAnswerKey("current_location")]: "Bengaluru",
      [standardAnswerKey("expected_salary")]: { amount: 1500000, currency: "INR" },
    });
  });

  it("skips fields that are off or missing from the profile", () => {
    expect(prefillStandardAnswers(formWith({ linkedin_url: "off", phone: "required" }), PROFILE)).toEqual({});
    expect(prefillStandardAnswers(formWith({ linkedin_url: "required" }), null)).toEqual({});
    expect(prefillStandardAnswers(formWith({ expected_salary: "required" }), { ...PROFILE, salary_currency: "₹" })).toEqual({});
  });
});
