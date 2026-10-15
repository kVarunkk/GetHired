import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { saveTemplateAction } from "@/app/actions/pipeline/save-template";
import { templateOf } from "@/test/utils/pipeline";
import type { TemplateVars } from "@/helpers/pipeline/templates";
import TemplateEditor from "./TemplateEditor";

vi.mock("@/app/actions/pipeline/save-template", () => ({ saveTemplateAction: vi.fn() }));
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
});
