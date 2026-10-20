import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey } from "@/helpers/applications/validate-answers";
import ApplicationFields, { type FieldValues } from "./ApplicationFields";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const FORM: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "short_text", label: "Your name", required: true, help_text: "As on your ID." },
    { id: id(2), type: "long_text", label: "Why us?", required: false },
    { id: id(3), type: "single_select", label: "Seniority", required: true, options: ["Junior", "Senior"] },
    { id: id(4), type: "multi_select", label: "Stacks", required: true, options: ["React", "Go", "Rust"] },
    { id: id(5), type: "yes_no", label: "Can you relocate?", required: true },
    { id: id(6), type: "number", label: "Years of React", required: true, min: 0 },
    { id: id(7), type: "date", label: "Start date", required: true },
    { id: id(8), type: "url", label: "Portfolio", required: true },
  ],
  standard_fields: { expected_salary: "optional" },
};

function Harness({ onValues, errors = {} }: { onValues: (v: FieldValues) => void; errors?: Record<string, string> }) {
  const [values, setValues] = useState<FieldValues>({});
  return (
    <ApplicationFields
      form={FORM}
      values={values}
      errors={errors}
      onChange={(key, value) => {
        const next = { ...values, [key]: value };
        setValues(next);
        onValues(next);
      }}
    />
  );
}

describe("ApplicationFields (AF-REQ-006)", () => {
  it("renders every type with its label, help text and optional marker", () => {
    render(<Harness onValues={vi.fn()} />);

    expect(screen.getByLabelText("Your name")).toHaveAttribute("type", "text");
    expect(screen.getByText("As on your ID.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Why us\?/).tagName).toBe("TEXTAREA");
    expect(screen.getAllByText("(optional)")).toHaveLength(2);
    expect(screen.getByRole("radiogroup", { name: "Seniority" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Stacks" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Can you relocate?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Years of React")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Portfolio")).toHaveAttribute("type", "url");
    expect(screen.getByLabelText(/Expected salary/)).toBeInTheDocument();
  });

  it("reports typed values", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("radio", { name: "Senior" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "React" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Go" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "React" }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.change(screen.getByLabelText("Years of React"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/Expected salary/), { target: { value: "120000" } });

    expect(onValues).toHaveBeenLastCalledWith({
      [id(1)]: "Ada",
      [id(3)]: "Senior",
      [id(4)]: ["Go"],
      [id(5)]: false,
      [id(6)]: 4,
      [standardAnswerKey("expected_salary")]: { amount: 120000, currency: "USD" },
    });
  });

  it("clears a number when the box is emptied", () => {
    const onValues = vi.fn();
    render(<Harness onValues={onValues} />);
    fireEvent.change(screen.getByLabelText("Years of React"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Years of React"), { target: { value: "" } });
    expect(onValues).toHaveBeenLastCalledWith({ [id(6)]: undefined });
  });

  it("shows errors next to their fields", () => {
    render(<Harness onValues={vi.fn()} errors={{ [id(1)]: "This question is required." }} />);
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("This question is required.")).toBeInTheDocument();
  });

  it("shows progress on long forms", () => {
    render(<Harness onValues={vi.fn()} />);
    expect(screen.getByText("0 of 7 required answered")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    expect(screen.getByText("1 of 7 required answered")).toBeInTheDocument();
  });
});
