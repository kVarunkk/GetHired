import { describe, expect, it } from "vitest";
import jevAnswers from "@/test/fixtures/jev-profile-answers.json";
import {
  APPLICATION,
  CANDIDATE_PROFILE,
  INJECTION_LINE,
  JOB_POST,
  PII,
  RESUME_CONTENT,
  explanationOf,
  screeningResultOf,
} from "./matching";

const profileText = JSON.stringify(CANDIDATE_PROFILE);
const resumeText = JSON.stringify(RESUME_CONTENT);

// The strip tests (MT-TEST-002) assert these are gone; they'd pass vacuously
// if the fixtures didn't contain them in the first place.
describe("matching fixtures", () => {
  it.each([
    ["name", PII.name],
    ["email", PII.email],
    ["phone", PII.phone],
    ["LinkedIn", PII.linkedin],
    ["GitHub", PII.github],
    ["date of birth", PII.dateOfBirth],
    ["gender", PII.gender],
    ["nationality", PII.nationality],
    ["religion", PII.religion],
    ["marital status", PII.maritalStatus],
    ["caste", PII.caste],
    ["photo", PII.photo],
  ])("the profile contains the candidate's %s", (_label, value) => {
    expect(profileText).toContain(value);
  });

  it("keeps visa_sponsorship_required on the profile", () => {
    expect(CANDIDATE_PROFILE.visa_sponsorship_required).toBe(false);
  });

  it.each([
    ["an email", PII.resumeEmail],
    ["a phone number", PII.resumePhone],
    ["a URL", PII.resumeUrl],
    ["the injection line", INJECTION_LINE],
  ])("the resume contains %s", (_label, value) => {
    expect(resumeText).toContain(value);
  });

  it("puts contact details inside the experience section, not only the contact section", () => {
    const experience = JSON.stringify(RESUME_CONTENT.sections?.find((s) => s.type === "experience"));
    expect(experience).toContain(PII.resumeEmail);
    expect(experience).toContain(PII.resumePhone);
  });

  it("aligns answers with the job's questions, with one empty", () => {
    expect(APPLICATION.job_post_id).toBe(JOB_POST.id);
    expect(APPLICATION.answers).toHaveLength(JOB_POST.questions.length);
    expect(APPLICATION.answers.filter((a) => a === "")).toHaveLength(1);
  });

  it("builds results that override cleanly", () => {
    expect(screeningResultOf({ fit_score: 40 }).fit_score).toBe(40);
    expect(screeningResultOf().answer_feedback).toHaveLength(JOB_POST.questions.length);
    expect(explanationOf({ gaps: [] }).gaps).toEqual([]);
  });

  it("records jev answers on the 0–4 scale (MT-ASSUMPTION-001)", () => {
    for (const key of ["skillsMatch", "experienceMatch"] as const) {
      const { score, probabilities } = jevAnswers[key];
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
      const mean = Object.entries(probabilities).reduce((t, [i, p]) => t + Number(i) * p, 0);
      expect(mean).toBeCloseTo(score, 2);
    }
    expect(jevAnswers.preferenceMismatch.type).toBe("boolean");
  });
});
