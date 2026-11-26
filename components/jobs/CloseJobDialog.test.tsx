import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CloseJobDialog, { type JobStateDialogKind } from "./CloseJobDialog";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));

function renderDialog(kind: JobStateDialogKind, openInterviews = 0) {
  const onSubmit = vi.fn(async () => true);
  const onOpenChange = vi.fn();
  render(
    <CloseJobDialog
      open
      onOpenChange={onOpenChange}
      kind={kind}
      jobTitle="Backend Engineer"
      openInterviews={openInterviews}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe("CloseJobDialog (JLT-021)", () => {
  it("needs a reason to close", async () => {
    const { onSubmit, onOpenChange } = renderDialog("close");
    const submit = screen.getByRole("button", { name: "Close job" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "cancelled" } });
    await userEvent.type(screen.getByLabelText("Note (optional)"), "  Budget cut  ");
    await userEvent.click(submit);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ reason: "cancelled", note: "Budget cut", cancelOpenInterviews: false }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks no reason to mark a job filled", async () => {
    const { onSubmit } = renderDialog("fill");
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark as filled" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ reason: null, note: null, cancelOpenInterviews: false }));
  });

  it("never offers deadline as a reason (the auto-close sets it)", () => {
    renderDialog("close");
    const options = [...(screen.getByLabelText("Reason") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).not.toContain("deadline");
  });

  it("hides the AI interview choice when there are none, and leaves it unchecked otherwise (D9)", async () => {
    renderDialog("fill");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("cancels the interviews only when checked", async () => {
    const { onSubmit } = renderDialog("fill", 1);
    const box = screen.getByRole("checkbox", { name: /Cancel 1 open AI interview/ });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Mark as filled" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ cancelOpenInterviews: true })));
  });

  it("needs a note to request changes, and offers no interview choice", async () => {
    const { onSubmit } = renderDialog("request_changes", 3);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Send back" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What should change"), "Add a salary range");
    await userEvent.click(submit);
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ reason: null, note: "Add a salary range", cancelOpenInterviews: false }),
    );
  });
});
