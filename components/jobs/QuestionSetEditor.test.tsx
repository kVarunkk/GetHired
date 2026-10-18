import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { saveQuestionSetAction } from "@/app/actions/question-sets/save-question-set";
import { deleteQuestionSetAction } from "@/app/actions/question-sets/delete-question-set";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import QuestionSetEditor from "./QuestionSetEditor";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("@/app/actions/question-sets/save-question-set", () => ({ saveQuestionSetAction: vi.fn() }));
vi.mock("@/app/actions/question-sets/delete-question-set", () => ({ deleteQuestionSetAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const SET_ID = "5e000000-0000-4000-8000-000000000001";
const FORM: ApplicationForm = {
  version: 1,
  questions: [{ id: "00000000-0000-4000-8000-000000000001", type: "yes_no", label: "Can you relocate?", required: true }],
  standard_fields: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuestionSetEditor (AF-REQ-004)", () => {
  it("creates a set and goes back to the list", async () => {
    vi.mocked(saveQuestionSetAction).mockResolvedValue({
      ok: true,
      set: { id: SET_ID, name: "Engineering", form: FORM, updatedAt: "2026-10-17" },
    });
    render(<QuestionSetEditor initialForm={FORM} />);

    const create = screen.getByRole("button", { name: "Create set" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Engineering " } });
    fireEvent.click(create);

    await waitFor(() => expect(saveQuestionSetAction).toHaveBeenCalledWith({ name: "Engineering", form: FORM }));
    expect(toast.success).toHaveBeenCalledWith("Saved “Engineering”.");
    expect(push).toHaveBeenCalledWith("/company/settings/question-sets");
  });

  it("saves an existing set by id and shows server errors", async () => {
    vi.mocked(saveQuestionSetAction).mockResolvedValue({ ok: false, error: "A set with this name already exists." });
    render(<QuestionSetEditor id={SET_ID} initialName="Engineering" initialForm={FORM} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(saveQuestionSetAction).toHaveBeenCalledWith({ id: SET_ID, name: "Engineering", form: FORM }),
    );
    expect(toast.error).toHaveBeenCalledWith("A set with this name already exists.");
    expect(push).not.toHaveBeenCalled();
  });

  it("deletes after confirming", async () => {
    vi.mocked(deleteQuestionSetAction).mockResolvedValue({ ok: true });
    render(<QuestionSetEditor id={SET_ID} initialName="Engineering" initialForm={FORM} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete set" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteQuestionSetAction).toHaveBeenCalledWith({ id: SET_ID }));
    expect(push).toHaveBeenCalledWith("/company/settings/question-sets");
  });

  it("is read-only without question_sets.manage", () => {
    render(<QuestionSetEditor id={SET_ID} initialName="Engineering" initialForm={FORM} readOnly />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete set" })).not.toBeInTheDocument();
  });
});
