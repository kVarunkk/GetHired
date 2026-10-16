import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { loadOutreachComposerAction, type LoadComposerResult } from "@/app/actions/outreach/load-composer";
import { sendOutreachAction } from "@/app/actions/outreach/send-outreach";
import { draftOutreachAction } from "@/app/actions/outreach/draft-outreach";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB, outreachOf } from "@/test/utils/outreach";
import OutreachComposer from "./OutreachComposer";

const handleEntitlement = vi.fn();
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: handleEntitlement, show: vi.fn(), dialog: <div data-testid="upgrade" /> }),
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/outreach/load-composer", () => ({ loadOutreachComposerAction: vi.fn() }));
vi.mock("@/app/actions/outreach/send-outreach", () => ({ sendOutreachAction: vi.fn() }));
vi.mock("@/app/actions/outreach/draft-outreach", () => ({ draftOutreachAction: vi.fn() }));

// Radix Select doesn't run in jsdom; a native <select> named by the trigger's
// aria-label keeps the same contract.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger: (props: { "aria-label"?: string; className?: string; children?: ReactNode }) => null =
    () => null;
  return {
    Select: ({
      value,
      disabled,
      onValueChange,
      children,
    }: {
      value: string;
      disabled?: boolean;
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
          disabled={disabled}
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

const CONTEXT: Extract<LoadComposerResult, { ok: true }> = {
  ok: true,
  candidateFirstName: "Ada",
  acceptsOutreach: true,
  jobs: [{ id: OUTREACH_JOB.id, title: "Frontend Engineer" }],
  templates: [
    {
      id: "t1",
      name: "Intro",
      subject: "{{job_title}} at {{company_name}}",
      body_md: "Hi {{candidate_first_name}}, book a time: {{scheduling_link}}",
    },
  ],
  quota: { remaining: 12, amount: 150 },
  companyName: "Acme",
  schedulingLink: null,
  senderName: "Sam",
  latest: null,
};

const onOpenChange = vi.fn();
const onSent = vi.fn();

function open(context: LoadComposerResult = CONTEXT) {
  vi.mocked(loadOutreachComposerAction).mockResolvedValue(context);
  return render(
    <OutreachComposer
      candidateId={PUBLIC_APPLICANT.id}
      open
      onOpenChange={onOpenChange}
      onSent={onSent}
    />,
  );
}

const send = () => screen.getByRole("button", { name: "Send" });

async function fill(subject = "Frontend role", message = "Hi Ada, open to a chat?") {
  // Pasting rather than typing keeps these tests fast when the whole suite runs.
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText("Subject"));
  await user.paste(subject);
  await user.click(screen.getByLabelText("Message"));
  await user.paste(message);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  handleEntitlement.mockResolvedValue(false);
});

describe("OutreachComposer (ORT-031, OR-TEST-007)", () => {
  it("lists only the active jobs it was given, plus No job", async () => {
    open();
    const picker = await screen.findByLabelText("Job");
    const options = [...(picker as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["No job", "Frontend Engineer"]);
    expect(loadOutreachComposerAction).toHaveBeenCalledWith({ candidateId: PUBLIC_APPLICANT.id });
  });

  it("shows the remaining monthly quota", async () => {
    open();
    expect(await screen.findByText("12 of 150 left this month")).toBeInTheDocument();
  });

  it("disables Send while empty or over the limits, with counters", async () => {
    open();
    await screen.findByLabelText("Subject");
    expect(send()).toBeDisabled();

    const user = await fill("s".repeat(121), "Hi");
    expect(screen.getByLabelText("Subject length")).toHaveTextContent("121/120");
    expect(send()).toBeDisabled();

    await user.clear(screen.getByLabelText("Subject"));
    await user.type(screen.getByLabelText("Subject"), "Fine");
    expect(send()).toBeEnabled();
  });

  it("disables the composer with a note when the candidate doesn't accept outreach", async () => {
    open({ ...CONTEXT, acceptsOutreach: false });
    expect(await screen.findByText("Ada isn't accepting outreach right now.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(send()).toBeDisabled();
  });

  it("sends, toasts and closes", async () => {
    vi.mocked(sendOutreachAction).mockResolvedValue({ ok: true, outreach: outreachOf("sent"), emailed: true });
    open();
    const user = await fill();
    await user.selectOptions(screen.getByLabelText("Job"), OUTREACH_JOB.id);

    await user.click(send());

    expect(sendOutreachAction).toHaveBeenCalledWith({
      candidateId: PUBLIC_APPLICANT.id,
      jobPostId: OUTREACH_JOB.id,
      subject: "Frontend role",
      message: "Hi Ada, open to a chat?",
    });
    expect(toast.success).toHaveBeenCalledWith("Message sent to Ada.");
    expect(onSent).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows ALREADY_OPEN inline and keeps the text", async () => {
    vi.mocked(sendOutreachAction).mockResolvedValue({
      ok: false,
      code: "ALREADY_OPEN",
      status: 409,
      error: "You already have an open message to this candidate about this job.",
    });
    open();
    const user = await fill();

    await user.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent("You already have an open message");
    expect(screen.getByLabelText("Message")).toHaveValue("Hi Ada, open to a chat?");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens the upgrade dialog at the monthly limit instead of sending", async () => {
    const limit = { ok: false as const, error: { code: "entitlement" as const, message: "limit", key: "outreach" } };
    vi.mocked(sendOutreachAction).mockResolvedValue(limit as never);
    handleEntitlement.mockResolvedValue(true);
    open({ ...CONTEXT, quota: { remaining: 0, amount: 10 } });
    expect(await screen.findByText("0 of 10 left this month")).toBeInTheDocument();
    const user = await fill();

    await user.click(send());

    expect(handleEntitlement).toHaveBeenCalledWith(limit);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("upgrade")).toBeInTheDocument();
  });

  it("inserts a custom template and flags a missing scheduling link", async () => {
    open();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Job"), OUTREACH_JOB.id);

    await user.selectOptions(screen.getByLabelText("Template"), "t1");

    expect(screen.getByLabelText("Subject")).toHaveValue("Frontend Engineer at Acme");
    expect(screen.getByLabelText("Message")).toHaveValue("Hi Ada, book a time: {{scheduling_link}}");
    expect(screen.getByText(/add a scheduling link in Settings/)).toBeInTheDocument();
  });

  it("fills the message with an AI draft, disabling Send while drafting (ORT-071)", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof draftOutreachAction>>) => void;
    vi.mocked(draftOutreachAction).mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    const user = await fill("Subject", "x");

    await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
    expect(screen.getByLabelText("Drafting")).toBeInTheDocument();
    expect(send()).toBeDisabled();

    resolve({ ok: true, subject: "Ignored: subject already set", message: "Hi Ada, a drafted note." });
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("Hi Ada, a drafted note."));
    expect(screen.getByLabelText("Subject")).toHaveValue("Subject");
    expect(send()).toBeEnabled();
    expect(draftOutreachAction).toHaveBeenCalledWith({ candidateId: PUBLIC_APPLICANT.id, jobPostId: null });
  });

  it("shows a draft refusal inline", async () => {
    vi.mocked(draftOutreachAction).mockResolvedValue({ ok: false, error: "You've used today's 20 AI drafts." });
    open();
    const user = userEvent.setup();
    await screen.findByLabelText("Subject");

    await user.click(screen.getByRole("button", { name: /Draft with AI/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("20 AI drafts");
  });
});
