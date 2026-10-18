import { describe, expect, it } from "vitest";
import { screenInterviewConfigFairness } from "./config-fairness";

const config = (overrides: Partial<Parameters<typeof screenInterviewConfigFairness>[0]> = {}) => ({
  questions: [{ text: "Walk me through a system you designed." }],
  competencies: [{ name: "Communication", description: "Explains trade-offs clearly" }],
  ...overrides,
});

describe("screenInterviewConfigFairness (SI-SEC-006, SI-TEST-001)", () => {
  it("accepts job-related competencies and questions", () => {
    expect(screenInterviewConfigFairness(config())).toEqual({ ok: true });
  });

  it.each([
    ["native English speaker", "native language"],
    ["Under 30", "age"],
    ["Young and energetic", "young"],
  ])("rejects the competency name %j and names the field", (name, term) => {
    const result = screenInterviewConfigFairness(
      config({ competencies: [{ name: "Communication", description: "Clear" }, { name, description: "x" }] }),
    );
    expect(result).toEqual({
      ok: false,
      field: "competencies.1.name",
      error: `Competencies can't be about ${term}. Change or remove "${name}".`,
    });
  });

  it("rejects a description that mentions a protected characteristic", () => {
    const result = screenInterviewConfigFairness(
      config({ competencies: [{ name: "Communication", description: "Speaks with a neutral accent" }] }),
    );
    expect(result).toEqual({
      ok: false,
      field: "competencies.0.description",
      error: `The description of "Communication" can't mention accent.`,
    });
  });

  it("rejects \"culture fit\" without a job-related description", () => {
    const result = screenInterviewConfigFairness(
      config({ competencies: [{ name: "Culture fit", description: "  " }] }),
    );
    expect(result).toMatchObject({ ok: false, field: "competencies.0.description" });
    expect(result.ok === false && result.error).toContain('"Culture fit" needs a job-related description');
  });

  it("accepts \"culture fit\" with a job-related description", () => {
    expect(
      screenInterviewConfigFairness(
        config({ competencies: [{ name: "Culture fit", description: "Gives and takes direct feedback in code reviews" }] }),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a question about a protected characteristic", () => {
    const text = "Are you married?";
    expect(screenInterviewConfigFairness(config({ questions: [{ text }] }))).toEqual({
      ok: false,
      field: "questions.0.text",
      error: `Interview questions can't ask about marital status. Change or remove "${text}".`,
    });
  });
});
