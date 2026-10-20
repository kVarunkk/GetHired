import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { createTemplateAction } from "@/app/actions/pipeline/create-template";
import { deleteTemplateAction } from "@/app/actions/pipeline/delete-template";
import { saveTemplateAction } from "@/app/actions/pipeline/save-template";
import { templateOf } from "@/test/utils/pipeline";
import type { TemplateVars } from "@/helpers/pipeline/templates";
import TemplateEditor from "./TemplateEditor";

vi.mock("@/app/actions/pipeline/save-template", () => ({ saveTemplateAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/create-template", () => ({ createTemplateAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/delete-template", () => ({ deleteTemplateAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

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

const TEMPLATES = (["rejection", "advance", "interview_invite", "offer", "custom"] as const).map((p) =>
  templateOf(p),
);
const SAMPLE: TemplateVars = {
  candidate_first_name: "Priya",
  job_title: "Backend Engineer",
  company_name: "Acme",
  scheduling_link: null,
  sender_name: "Asha",
};

const picker = () => screen.getByRole("combobox", { name: "Template" });
const subject = () => screen.getByRole("textbox", { name: "Subject" }) as HTMLInputElement;
const message = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const preview = () => screen.getByRole("region", { name: "Preview" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveTemplateAction).mockResolvedValue({ ok: true });
  vi.mocked(deleteTemplateAction).mockResolvedValue({ ok: true });
});

describe("TemplateEditor (PLT-064)", () => {
  it("edits one template per purpose", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    expect(picker()).toHaveValue(TEMPLATES[0].id);
    expect(subject()).toHaveValue(TEMPLATES[0].subject);

    fireEvent.change(picker(), { target: { value: TEMPLATES[1].id } });
    expect(subject()).toHaveValue(TEMPLATES[1].subject);
    expect(message()).toHaveValue(TEMPLATES[1].body_md);
  });

  it("previews the template with sample values as you type", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(subject(), { target: { value: "{{job_title}} at {{company_name}}" } });
    fireEvent.change(message(), { target: { value: "Hi **{{candidate_first_name}}**" } });

    expect(preview()).toHaveTextContent("Backend Engineer at Acme");
    expect(preview().querySelector("strong")).toHaveTextContent("Priya");
  });

  it("inserts a variable chip at the cursor", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(message(), { target: { value: "Hi , thanks" } });
    message().setSelectionRange(3, 3);
    fireEvent.click(screen.getByRole("button", { name: "Insert {{candidate_first_name}}" }));

    expect(message()).toHaveValue("Hi {{candidate_first_name}}, thanks");
  });

  it("counts characters against the limits and blocks saving over them", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(subject(), { target: { value: "x".repeat(151) } });

    expect(screen.getByText("151 / 150")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
  });

  it("flags unknown variables and blocks saving", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(message(), { target: { value: "Hi {{first_name}}" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Unknown variable: {{first_name}}");
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
  });

  it("notes a missing scheduling link in the preview", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(picker(), { target: { value: TEMPLATES[2].id } });

    expect(screen.getByText(/Add a scheduling link below/)).toBeInTheDocument();
  });

  it("saves through saveTemplateAction", async () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.change(subject(), { target: { value: "New subject" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(saveTemplateAction).toHaveBeenCalledWith({
      templateId: TEMPLATES[0].id,
      name: TEMPLATES[0].name,
      subject: "New subject",
      body: TEMPLATES[0].body_md,
    });
  });

  it("toasts a refusal", async () => {
    vi.mocked(saveTemplateAction).mockResolvedValue({ ok: false, error: "Template not found." });
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Template not found."));
  });

  it("adds a new template, starting from the purpose's default wording", async () => {
    const created = templateOf("offer", {
      id: "7e700000-0000-4000-8000-0000000000aa",
      name: "Offer (contract)",
      is_default: false,
    });
    vi.mocked(createTemplateAction).mockResolvedValue({ ok: true, template: created });
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Purpose" }), { target: { value: "offer" } });
    expect(subject()).toHaveValue(TEMPLATES[3].subject);
    expect(screen.getByRole("button", { name: "Add template" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Offer (contract)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add template" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Template added."));
    expect(createTemplateAction).toHaveBeenCalledWith({
      purpose: "offer",
      name: "Offer (contract)",
      subject: TEMPLATES[3].subject,
      body: TEMPLATES[3].body_md,
    });
    expect(picker()).toHaveValue(created.id);
  });

  it("cancels a new template back to the selected one", () => {
    render(<TemplateEditor templates={TEMPLATES} sampleVars={SAMPLE} />);

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(picker()).toHaveValue(TEMPLATES[0].id);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(TEMPLATES[0].name);
  });

  it("deletes a company template after confirming, but never offers it for a default", async () => {
    const own = templateOf("rejection", { id: "7e700000-0000-4000-8000-0000000000bb", name: "Soft no", is_default: false });
    render(<TemplateEditor templates={[...TEMPLATES, own]} sampleVars={SAMPLE} />);

    expect(screen.queryByRole("button", { name: "Delete template" })).not.toBeInTheDocument();

    fireEvent.change(picker(), { target: { value: own.id } });
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(deleteTemplateAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Template deleted."));
    expect(deleteTemplateAction).toHaveBeenCalledWith({ templateId: own.id });
    expect(picker()).toHaveValue(TEMPLATES[0].id);
    expect(screen.queryByRole("option", { name: /Soft no/ })).not.toBeInTheDocument();
  });
});
