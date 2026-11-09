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

describe("location questions", () => {
  const multi = { question: "Where do you want to work?", kind: "locations" as const, multiSelect: true };
  const single = { question: "Where is the job based?", kind: "locations" as const };

  it("take the kind with no options", () => {
    expect(askUserInputSchema.safeParse({ questions: [multi, single] }).success).toBe(true);
    expect(askUserInputSchema.safeParse({ questions: [{ ...single, kind: "cities" }] }).success).toBe(false);
  });

  it("need picked places only, one or more even without multiSelect", () => {
    expect(answerComplete(multi, { selected: [], locations: ["Bengaluru", "Remote"] })).toBe(true);
    expect(answerComplete(single, { selected: [], locations: ["Pune"] })).toBe(true);
    expect(answerComplete(single, { selected: [], locations: ["Pune", "Delhi"] })).toBe(true);
    expect(answerComplete(single, { selected: [] })).toBe(false);
    expect(answerComplete(multi, { selected: [] })).toBe(false);
    expect(answerComplete(multi, { selected: [], other: "somewhere warm" })).toBe(false);
    expect(answerComplete(multi, { selected: [0], locations: ["Pune"] })).toBe(false);
    expect(answerComplete(multi, { selected: [], locations: ["Pune", "pune"] })).toBe(false);
  });

  it("are the only questions that take locations", () => {
    expect(answerComplete(INPUT.questions[0], { selected: [0], locations: ["Pune"] })).toBe(false);
    expect(
      outputFitsInput({ questions: [multi] }, { answers: [{ selected: [], locations: ["Bengaluru"] }] }),
    ).toBe(true);
  });

  it("cap the number and length of places", () => {
    const many = Array.from({ length: 21 }, (_, i) => `City ${i}`);
    expect(askUserOutputSchema.safeParse({ answers: [{ selected: [], locations: many }] }).success).toBe(false);
    expect(askUserOutputSchema.safeParse({ answers: [{ selected: [], locations: ["x".repeat(101)] }] }).success).toBe(
      false,
    );
    expect(askUserOutputSchema.safeParse({ answers: [{ selected: [], locations: [] }] }).success).toBe(false);
  });

  it("tell the model the places the user picked", () => {
    const text = askUserResultForModel(
      { questions: [multi] },
      { answers: [{ selected: [], locations: ["Bengaluru", "Remote"] }] },
    );
    expect(text).toContain('picked these locations from the location search: "Bengaluru"; "Remote"');
  });
});
