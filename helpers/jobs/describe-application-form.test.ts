import { describe, expect, it } from "vitest";
import { describeApplicationForm } from "./describe-application-form";

describe("describeApplicationForm (CPT-023)", () => {
  it("lists each question with its type, whether it's required and its knockout action", () => {
    expect(
      describeApplicationForm({
        version: 1,
        questions: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            type: "yes_no",
            label: "Can you relocate?",
            required: true,
            knockout: { fail_if: { kind: "equals", value: false }, action: "flag" },
          },
          { id: "00000000-0000-4000-8000-000000000002", type: "url", label: "Portfolio", required: false },
        ],
        standard_fields: { phone: "optional", cover_letter: "off" },
      }),
    ).toBe(
      "Can you relocate? (Yes / no, required, knockout: flag)\nPortfolio (Link, optional)\nStandard fields: Phone (optional)",
    );
  });

  it("says when a draft doesn't validate", () => {
    expect(describeApplicationForm({ questions: "nope" })).toBe("An application form that doesn't validate yet.");
  });
});
