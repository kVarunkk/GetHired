import { describe, expect, it } from "vitest";
import { jobPostingInputSchema } from "./job-posting-schema";

/** What CreateJobPostingDialog submits after its own zod resolver. */
const VALID = {
  title: "  Frontend Engineer  ",
  description: "Build the product UI with React and TypeScript.",
  location: ["bengaluru", "remote"],
  job_type: "Fulltime",
  salary_currency: "₹",
  min_salary: 1500000,
  max_salary: 2500000,
  min_experience: 2,
  max_experience: 5,
  visa_sponsorship: "Not Required",
  min_equity: 0,
  max_equity: 0.5,
  questions: ["Why us?", "  ", ""],
};

const parse = (overrides: Record<string, unknown>) =>
  jobPostingInputSchema.safeParse({ ...VALID, ...overrides });

describe("jobPostingInputSchema", () => {
  it("parses what the create dialog sends, trimming the title and blank questions", () => {
    const result = jobPostingInputSchema.safeParse(VALID);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ title: "Frontend Engineer", questions: ["Why us?"] });
  });

  it("accepts a payload without the optional fields", () => {
    const rest: Record<string, unknown> = { ...VALID };
    for (const key of ["max_experience", "min_equity", "max_equity", "questions"]) delete rest[key];

    expect(jobPostingInputSchema.safeParse(rest).success).toBe(true);
  });

  it.each(["company_id", "id", "job_id", "status", "matching_status", "created_at"])(
    "rejects the extra key %s instead of stripping it",
    (key) => {
      expect(parse({ [key]: "c0000000-0000-4000-8000-000000000002" }).success).toBe(false);
    },
  );

  it("rejects more than 10 questions", () => {
    const questions = Array.from({ length: 11 }, (_, i) => `Question ${i}?`);
    expect(parse({ questions }).success).toBe(false);
  });

  it("rejects a question over 300 characters", () => {
    expect(parse({ questions: ["x".repeat(301)] }).success).toBe(false);
  });

  it.each([
    ["salary", { min_salary: 300, max_salary: 200 }],
    ["experience", { min_experience: 6, max_experience: 3 }],
    ["equity", { min_equity: 2, max_equity: 1 }],
  ])("rejects a min %s above the max", (_, overrides) => {
    expect(parse(overrides).success).toBe(false);
  });

  it("requires location and skills to be string arrays", () => {
    expect(parse({ location: "bengaluru" }).success).toBe(false);
    expect(parse({ location: [1] }).success).toBe(false);
    expect(parse({ skills: "React" }).success).toBe(false);
    expect(parse({ skills: ["React", "Go"] }).success).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(parse({ title: "   " }).success).toBe(false);
  });

  it("rejects an unknown job type or visa option", () => {
    expect(parse({ job_type: "Freelance" }).success).toBe(false);
    expect(parse({ visa_sponsorship: "Maybe" }).success).toBe(false);
  });
});
