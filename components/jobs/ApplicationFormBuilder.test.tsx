import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MAX_FORM_QUESTIONS, emptyApplicationForm, type ApplicationForm } from "@/helpers/jobs/application-form-schema";
import ApplicationFormBuilder from "./ApplicationFormBuilder";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function Harness({
  initial = emptyApplicationForm(),
  answeredQuestionIds,
  onForm = vi.fn(),
}: {
  initial?: ApplicationForm;
  answeredQuestionIds?: string[];
  onForm?: (form: ApplicationForm) => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <ApplicationFormBuilder
      value={form}
      answeredQuestionIds={answeredQuestionIds}
      onChange={(next) => {
        setForm(next);
        onForm(next);
      }}
    />
  );
}

const TWO: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "short_text", label: "First", required: true },
    { id: id(2), type: "long_text", label: "Second", required: false },
  ],
  standard_fields: {},
};

const lastForm = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as ApplicationForm;
const cards = () => screen.getAllByRole("group", { name: /^Question \d+$/ });

describe("ApplicationFormBuilder (AF-REQ-001/002/005, CPT-020)", () => {
  it("adds a question and edits its label, help text and required flag", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} />);

    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const card = within(cards()[0]);
    fireEvent.change(card.getByLabelText("Question"), { target: { value: "Why us?" } });
    fireEvent.change(card.getByLabelText("Help text"), { target: { value: "A few lines." } });
    fireEvent.click(card.getByRole("checkbox", { name: "Required" }));

    const q = lastForm(onForm).questions[0];
    expect(q).toMatchObject({ type: "long_text", label: "Why us?", help_text: "A few lines.", required: false });
    expect(q.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sets type-specific settings: options for choices", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} initial={TWO} />);

    const card = within(cards()[0]);
    fireEvent.change(card.getByLabelText("Answer type"), { target: { value: "single_select" } });
    fireEvent.change(card.getByLabelText("Options, one per line"), { target: { value: "Junior\nSenior\n" } });

    expect(lastForm(onForm).questions[0]).toMatchObject({ id: id(1), type: "single_select", options: ["Junior", "Senior"] });
  });

  it("sets a number range", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} initial={TWO} />);
    const card = within(cards()[0]);
    fireEvent.change(card.getByLabelText("Answer type"), { target: { value: "number" } });
    fireEvent.change(card.getByLabelText("Minimum"), { target: { value: "0" } });
    fireEvent.change(card.getByLabelText("Maximum"), { target: { value: "40" } });
    fireEvent.click(card.getByRole("checkbox", { name: "Whole numbers only" }));
    expect(lastForm(onForm).questions[0]).toMatchObject({ type: "number", min: 0, max: 40, integer: true });
  });

  it("reorders and removes questions", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} initial={TWO} />);

    fireEvent.click(within(cards()[1]).getByRole("button", { name: "Move up" }));
    expect(lastForm(onForm).questions.map((q) => q.label)).toEqual(["Second", "First"]);
    expect(within(cards()[0]).getByRole("button", { name: "Move up" })).toBeDisabled();

    fireEvent.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(lastForm(onForm).questions.map((q) => q.label)).toEqual(["First"]);
  });

  it("archives an answered question when its type changes, and adds a new one in its place", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} initial={TWO} answeredQuestionIds={[id(1)]} />);

    fireEvent.change(within(cards()[0]).getByLabelText("Answer type"), { target: { value: "yes_no" } });

    const form = lastForm(onForm);
    const live = form.questions.filter((q) => !q.archived);
    expect(live.map((q) => [q.label, q.type])).toEqual([
      ["First", "yes_no"],
      ["Second", "long_text"],
    ]);
    expect(live[0].id).not.toBe(id(1));
    expect(form.questions.find((q) => q.id === id(1))).toMatchObject({ archived: true, type: "short_text" });
    expect(cards()).toHaveLength(2);
  });

  it("removes an answered question by archiving it", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} initial={TWO} answeredQuestionIds={[id(1)]} />);
    fireEvent.click(within(cards()[0]).getByRole("button", { name: "Remove" }));
    expect(lastForm(onForm).questions.find((q) => q.id === id(1))).toMatchObject({ archived: true });
  });

  it(`stops at ${MAX_FORM_QUESTIONS} questions, with the reason`, () => {
    const full: ApplicationForm = {
      version: 1,
      questions: Array.from({ length: MAX_FORM_QUESTIONS }, (_, i) => ({ id: id(i + 1), type: "short_text" as const, label: `Q${i}`, required: true })),
      standard_fields: {},
    };
    render(<Harness initial={full} />);
    expect(screen.getByRole("button", { name: "Add question" })).toBeDisabled();
    expect(screen.getByText(`You can add up to ${MAX_FORM_QUESTIONS} questions.`)).toBeInTheDocument();
  });

  it("toggles standard fields off, optional or required", () => {
    const onForm = vi.fn();
    render(<Harness onForm={onForm} />);

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "required" } });
    fireEvent.change(screen.getByLabelText("Cover letter"), { target: { value: "optional" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "off" } });

    expect(lastForm(onForm).standard_fields).toEqual({ cover_letter: "optional" });
  });
});
