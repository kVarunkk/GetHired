import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { previewEmailAction } from "@/app/actions/pipeline/preview-email";
import { stageOf, templateOf } from "@/test/utils/pipeline";
import MoveDialog, { type TemplateOption } from "./MoveDialog";

vi.mock("@/app/actions/pipeline/preview-email", () => ({ previewEmailAction: vi.fn() }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; children?: ReactNode }) => null = () => null;
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: ReactNode;
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement(child) && child.type === SelectTrigger,
      ) as { props: { "aria-label"?: string } } | undefined;
      return (
        <select
          aria-label={trigger?.props["aria-label"]}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const option = (t: ReturnType<typeof templateOf>): TemplateOption => ({
  id: t.id,
  purpose: t.purpose,
  name: t.name,
  subject: t.subject,
  body_md: t.body_md,
  is_default: t.is_default,
});

const REJECTION = templateOf("rejection");
const SOFT_REJECTION = templateOf("rejection", {
  id: "7e700000-0000-4000-8000-0000000000aa",
  name: "Soft rejection",
  subject: "About {{job_title}}",
  is_default: false,
});
const TEMPLATES = [REJECTION, SOFT_REJECTION, templateOf("advance"), templateOf("custom")].map(option);
const REJECTED = { id: stageOf("rejected").id, name: "Rejected", kind: "rejected" as const };
const APP_ID = "ab000000-0000-4000-8000-000000000001";

function renderDialog(props: Partial<Parameters<typeof MoveDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <MoveDialog
      open
      count={3}
      stage={REJECTED}
      changesStatus
      templates={TEMPLATES}
      previewApplicationId={APP_ID}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return { onConfirm };
}

const emailSwitch = () => screen.getByRole("switch", { name: "Email candidates" });
const subject = () => screen.getByRole("textbox", { name: "Subject" });
const body = () => screen.getByRole("textbox", { name: "Message" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewEmailAction).mockImplementation(async ({ subject: s, body: b }) => ({
    ok: true,
    subject: s.replace("{{job_title}}", "Backend Engineer"),
    body: b,
    unknownVariables: [],
    missingVariables: [],
  }));
});

describe("MoveDialog (PLT-063, PL-TEST-006)", () => {
  it("turns email on by default when the move changes the candidate-facing status", () => {
    renderDialog();

    expect(emailSwitch()).toBeChecked();
    expect(screen.getByRole("button", { name: "Move and email 3" })).toBeEnabled();
  });

  it("leaves email off when the status doesn't change, and moves without one", () => {
    const { onConfirm } = renderDialog({ changesStatus: false });

    expect(emailSwitch()).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Subject" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("offers the stage kind's templates and starts with its default", () => {
    renderDialog();

    const picker = screen.getByRole("combobox", { name: "Template" });
    const names = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    expect(names).toEqual([REJECTION.name, "Soft rejection", templateOf("custom").name]);
    expect(picker).toHaveValue(REJECTION.id);
    expect(subject()).toHaveValue(REJECTION.subject);
    expect(body()).toHaveValue(REJECTION.body_md);

    fireEvent.change(picker, { target: { value: SOFT_REJECTION.id } });
    expect(subject()).toHaveValue("About {{job_title}}");
  });

  it("previews the rendered email for the first selected application", async () => {
    renderDialog();

    fireEvent.change(subject(), { target: { value: "Update on {{job_title}}" } });

    await waitFor(() =>
      expect(previewEmailAction).toHaveBeenLastCalledWith({
        applicationId: APP_ID,
        subject: "Update on {{job_title}}",
        body: REJECTION.body_md,
      }),
    );
    expect(await screen.findByText("Update on Backend Engineer")).toBeInTheDocument();
  });

  it("highlights unknown variables and disables the send until they're gone", async () => {
    renderDialog();

    fireEvent.change(body(), { target: { value: "Hi {{first_name}}" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Unknown variable: {{first_name}}");
    expect(screen.getByRole("button", { name: "Move and email 3" })).toBeDisabled();

    fireEvent.change(body(), { target: { value: "Hi {{candidate_first_name}}" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move and email 3" })).toBeEnabled();
  });

  it("disables the send when the preview finds a missing value", async () => {
    vi.mocked(previewEmailAction).mockResolvedValue({
      ok: true,
      subject: "x",
      body: "y",
      unknownVariables: [],
      missingVariables: ["scheduling_link"],
    });
    renderDialog();

    expect(await screen.findByText(/Add a scheduling link in Settings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move and email 3" })).toBeDisabled();
  });

  it("confirms with the template and only the edits as overrides", async () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Move and email 3" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ templateId: REJECTION.id });

    fireEvent.change(subject(), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Move and email 3" }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      templateId: REJECTION.id,
      overrides: { subject: "Edited", body: REJECTION.body_md },
    });
  });

  it("moves without email when it's switched off", () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(emailSwitch());
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("shows the status the candidate will see", () => {
    renderDialog();

    expect(screen.getByText(/The candidate will see/)).toHaveTextContent("rejected");
  });
});
