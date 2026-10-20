import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listQuestionSetsAction } from "@/app/actions/question-sets/list-question-sets";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import QuestionSetPicker from "./QuestionSetPicker";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

vi.mock("@/app/actions/question-sets/list-question-sets", () => ({ listQuestionSetsAction: vi.fn() }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET_FORM: ApplicationForm = {
  version: 1,
  questions: [{ id: id(1), type: "yes_no", label: "Can you relocate?", required: true }],
  standard_fields: { phone: "optional" },
};
const SET = { id: "5e000000-0000-4000-8000-000000000001", name: "Engineering", form: SET_FORM, updatedAt: "2026-10-17" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listQuestionSetsAction).mockResolvedValue({ ok: true, sets: [SET], canManage: true });
});

describe("QuestionSetPicker (AF-REQ-004, CPT-034)", () => {
  it("applies a copy of the chosen set", async () => {
    const onApply = vi.fn();
    render(<QuestionSetPicker onApply={onApply} />);

    fireEvent.change(await screen.findByLabelText("Question set"), { target: { value: SET.id } });
    fireEvent.click(screen.getByRole("button", { name: "Apply set" }));

    const applied = onApply.mock.calls[0][0] as ApplicationForm;
    expect(applied.questions.map((q) => q.label)).toEqual(["Can you relocate?"]);
    expect(applied.questions[0].id).not.toBe(id(1));
    expect(applied.standard_fields).toEqual({ phone: "optional" });
  });

  it("links to the question sets page in a new tab instead of saving in the dialog", async () => {
    render(<QuestionSetPicker onApply={vi.fn()} />);
    const link = await screen.findByRole("link", { name: /Manage question sets/ });
    expect(link).toHaveAttribute("href", "/company/settings/question-sets");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("button", { name: "Save as set" })).not.toBeInTheDocument();
  });

  it("offers to create a first set when there are none and the caller can manage", async () => {
    vi.mocked(listQuestionSetsAction).mockResolvedValue({ ok: true, sets: [], canManage: true });
    render(<QuestionSetPicker onApply={vi.fn()} />);
    const link = await screen.findByRole("link", { name: /Create a question set/ });
    expect(link).toHaveAttribute("href", "/company/settings/question-sets/new");
  });

  it("reloads the sets when the tab regains focus", async () => {
    vi.mocked(listQuestionSetsAction).mockResolvedValueOnce({ ok: true, sets: [], canManage: true });
    render(<QuestionSetPicker onApply={vi.fn()} />);
    await screen.findByRole("link", { name: /Create a question set/ });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("option", { name: "Engineering" })).toBeInTheDocument();
  });

  it("shows nothing when there are no sets and the caller can't manage them", async () => {
    vi.mocked(listQuestionSetsAction).mockResolvedValue({ ok: true, sets: [], canManage: false });
    const { container } = render(<QuestionSetPicker onApply={vi.fn()} />);
    await waitFor(() => expect(listQuestionSetsAction).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
