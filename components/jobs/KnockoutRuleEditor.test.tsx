import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FormQuestion, KnockoutRule } from "@/helpers/jobs/application-form-schema";
import KnockoutRuleEditor from "./KnockoutRuleEditor";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const ID = "00000000-0000-4000-8000-000000000001";

function Harness({ question, onRule }: { question: FormQuestion; onRule: (r: KnockoutRule | undefined) => void }) {
  const [q, setQ] = useState(question);
  return (
    <KnockoutRuleEditor
      question={q}
      onChange={(knockout) => {
        setQ({ ...q, knockout });
        onRule(knockout);
      }}
    />
  );
}

const q = (overrides: Partial<FormQuestion>) => ({ id: ID, type: "yes_no", label: "Can you relocate?", required: true, ...overrides }) as FormQuestion;

describe("KnockoutRuleEditor (AF-REQ-003, CPT-030)", () => {
  it("isn't offered on text, date or link questions", () => {
    const { container } = render(<KnockoutRuleEditor question={q({ type: "long_text" })} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts a yes/no rule as 'No' and flag by default (AF-DEC-002), and can switch to reject", () => {
    const onRule = vi.fn();
    render(<Harness question={q({})} onRule={onRule} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Knockout rule" }));
    expect(onRule).toHaveBeenLastCalledWith({ fail_if: { kind: "equals", value: false }, action: "flag" });

    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "reject" } });
    expect(onRule).toHaveBeenLastCalledWith({ fail_if: { kind: "equals", value: false }, action: "reject" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Knockout rule" }));
    expect(onRule).toHaveBeenLastCalledWith(undefined);
  });

  it("picks failing options on a choice question", () => {
    const onRule = vi.fn();
    render(<Harness question={q({ type: "single_select", label: "Seniority", options: ["Junior", "Senior"] })} onRule={onRule} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Knockout rule" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Senior" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Junior" }));

    expect(onRule).toHaveBeenLastCalledWith({ fail_if: { kind: "any_of", options: ["Senior"] }, action: "flag" });
  });

  it("sets a number bound", () => {
    const onRule = vi.fn();
    render(<Harness question={q({ type: "number", label: "Years of Go" })} onRule={onRule} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Knockout rule" }));
    fireEvent.change(screen.getByLabelText("Knockout value"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/when the answer is/), { target: { value: "greater_than" } });

    expect(onRule).toHaveBeenLastCalledWith({ fail_if: { kind: "greater_than", value: 3 }, action: "flag" });
  });

  it("is locked on a question the fairness check flags (AF-SEC-001)", () => {
    render(<KnockoutRuleEditor question={q({ label: "Are you married?" })} onChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "Knockout rule" })).not.toBeInTheDocument();
    expect(screen.getByText(/protected characteristic/)).toBeInTheDocument();
  });
});
