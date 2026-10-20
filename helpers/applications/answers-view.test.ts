import { describe, expect, it } from "vitest";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { answersView, safeAnswerUrl } from "./answers-view";
import { standardAnswerKey } from "./validate-answers";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SNAPSHOT: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "yes_no", label: "Can you relocate?", required: true },
    { id: id(2), type: "multi_select", label: "Stacks", required: true, options: ["React", "Go"] },
    { id: id(3), type: "short_text", label: "Nickname", required: false },
    { id: id(4), type: "url", label: "Portfolio", required: true },
  ],
  standard_fields: { expected_salary: "optional" },
};

describe("answersView (AF-REQ-005/008, CPT-021)", () => {
  it("labels typed answers with the question text the candidate saw", () => {
    const view = answersView(
      {
        answers: [],
        answers_v2: {
          [id(1)]: false,
          [id(2)]: ["React", "Go"],
          [id(4)]: "https://ada.dev",
          [standardAnswerKey("expected_salary")]: { amount: 120000, currency: "USD" },
        },
        form_snapshot: SNAPSHOT,
      },
      ["ignored"],
    );

    expect(view).toEqual([
      { key: id(1), label: "Can you relocate?", type: "yes_no", text: "No", url: null },
      { key: id(2), label: "Stacks", type: "multi_select", text: "React, Go", url: null },
      { key: id(3), label: "Nickname", type: "short_text", text: null, url: null },
      { key: id(4), label: "Portfolio", type: "url", text: "https://ada.dev", url: "https://ada.dev" },
      { key: standardAnswerKey("expected_salary"), label: "Expected salary", type: "salary", text: "120,000 USD", url: null },
    ]);
  });

  it("falls back to the job's questions for an old application", () => {
    expect(answersView({ answers: ["Mission", ""], answers_v2: null, form_snapshot: null }, ["Why us?", "Notice?"])).toEqual([
      { key: id(1), label: "Why us?", type: "long_text", text: "Mission", url: null },
      { key: id(2), label: "Notice?", type: "long_text", text: null, url: null },
    ]);
  });

  it("is empty when nothing was asked", () => {
    expect(answersView({ answers: [], answers_v2: null, form_snapshot: null }, [])).toEqual([]);
  });

  it("never links anything but http(s) (AF-SEC-002)", () => {
    expect(safeAnswerUrl("javascript:alert(1)")).toBeNull();
    expect(safeAnswerUrl("https://ada.dev/x")).toBe("https://ada.dev/x");
  });
});
