import { describe, expect, it } from "vitest";
import { answerFilterQuestions } from "./answer-filters";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("answerFilterQuestions (AF-REQ-008)", () => {
  it("offers yes/no and single-choice questions, skipping archived and other types", () => {
    expect(
      answerFilterQuestions({
        version: 1,
        questions: [
          { id: id(1), type: "yes_no", label: "Relocate?", required: true },
          { id: id(2), type: "single_select", label: "Seniority", required: true, options: ["Junior", "Senior"] },
          { id: id(3), type: "multi_select", label: "Stacks", required: true, options: ["A", "B"] },
          { id: id(4), type: "yes_no", label: "Old", required: true, archived: true },
        ],
        standard_fields: {},
      }),
    ).toEqual([
      { id: id(1), label: "Relocate?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      { id: id(2), label: "Seniority", options: [{ value: "Junior", label: "Junior" }, { value: "Senior", label: "Senior" }] },
    ]);
  });
});
