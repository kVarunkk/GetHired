import { describe, expect, it } from "vitest";
import {
  answerComplete,
  askUserInputSchema,
  askUserOutputSchema,
  askUserResultForModel,
  outputFitsInput,
  type AskUserInput,
} from "./ask-user";

const INPUT: AskUserInput = {
  questions: [
    {
      question: "Which job should I tailor it for?",
      options: [{ label: "Frontend Engineer at Acme" }, { label: "React Developer at Globex" }],
    },
    {
      question: "Which sections do you want?",
      options: [{ label: "Summary" }, { label: "Projects" }, { label: "Skills" }],
      multiSelect: true,
    },
    { question: "How many people did you manage?" },
  ],
};

describe("askUserInputSchema", () => {
  it("takes 1 to 4 questions with 2 to 6 options", () => {
    expect(askUserInputSchema.safeParse(INPUT).success).toBe(true);
    expect(askUserInputSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      askUserInputSchema.safeParse({ questions: [{ question: "Pick one?", options: [{ label: "Only" }] }] }).success,
    ).toBe(false);
  });
});

describe("answerComplete", () => {
  const [single, multi, free] = INPUT.questions;

  it("needs exactly one answer to a single choice", () => {
    expect(answerComplete(single, { selected: [1] })).toBe(true);
    expect(answerComplete(single, { selected: [], other: "Something else" })).toBe(true);
    expect(answerComplete(single, { selected: [0, 1] })).toBe(false);
    expect(answerComplete(single, { selected: [0], other: "and this" })).toBe(false);
    expect(answerComplete(single, { selected: [] })).toBe(false);
  });

  it("takes one or more answers to a multiple choice", () => {
    expect(answerComplete(multi, { selected: [0, 2] })).toBe(true);
    expect(answerComplete(multi, { selected: [0], other: "Awards" })).toBe(true);
    expect(answerComplete(multi, { selected: [0, 0] })).toBe(false);
  });

  it("rejects an option that isn't there", () => {
    expect(answerComplete(single, { selected: [4] })).toBe(false);
  });

  it("needs the user's own words when there are no options", () => {
    expect(answerComplete(free, { selected: [], other: "Five" })).toBe(true);
    expect(answerComplete(free, { selected: [0] })).toBe(false);
    expect(answerComplete(free, { selected: [] })).toBe(false);
  });
});

describe("outputFitsInput", () => {
  const answers = [{ selected: [0] }, { selected: [1, 2] }, { selected: [], other: "Five" }];

  it("accepts a complete answer to every question", () => {
    expect(outputFitsInput(INPUT, { answers })).toBe(true);
    expect(outputFitsInput(INPUT, { dismissed: true })).toBe(true);
  });

  it("rejects missing, extra or incomplete answers", () => {
    expect(outputFitsInput(INPUT, { answers: answers.slice(0, 2) })).toBe(false);
    expect(outputFitsInput(INPUT, { answers: [...answers, { selected: [0] }] })).toBe(false);
    expect(outputFitsInput(INPUT, { answers: [{ selected: [] }, ...answers.slice(1)] })).toBe(false);
  });

  it("rejects an output for questions it can't read", () => {
    expect(outputFitsInput({ questions: "nope" }, { answers })).toBe(false);
  });
});

describe("askUserOutputSchema", () => {
  it("allows no extra fields", () => {
    expect(askUserOutputSchema.safeParse({ answers: [{ selected: [0], label: "x" }] }).success).toBe(false);
    expect(askUserOutputSchema.safeParse({ dismissed: true, answers: [] }).success).toBe(false);
  });
});

describe("askUserResultForModel", () => {
  it("names the chosen labels from the questions and quotes the user's words", () => {
    const text = askUserResultForModel(INPUT, {
      answers: [{ selected: [1] }, { selected: [0, 2], other: "Awards" }, { selected: [], other: "Five" }],
    });
    expect(text).toContain("1. Which job should I tailor it for?\n   The user chose: React Developer at Globex");
    expect(text).toContain('chose: Summary; Skills, and in their own words: "Awards"');
    expect(text).toContain('3. How many people did you manage?\n   The user in their own words: "Five"');
  });

  it("never throws on a stored output of another shape", () => {
    expect(askUserResultForModel(INPUT, "[askUser returned 1 answers]")).toBe("[askUser returned 1 answers]");
    expect(askUserResultForModel(INPUT, null)).toMatch(/didn't report/);
    expect(askUserResultForModel(INPUT, { answers: "x" })).toMatch(/didn't report/);
  });

  it("tells the model when the user closed the card", () => {
    expect(askUserResultForModel(INPUT, { dismissed: true })).toMatch(/closed the questions/);
  });
});
