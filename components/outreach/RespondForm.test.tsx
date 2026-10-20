import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { respondToOutreachAction } from "@/app/actions/outreach/respond-to-outreach";
import { outreachOf } from "@/test/utils/outreach";
import RespondForm from "./RespondForm";
import PlainMessage from "./PlainMessage";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/outreach/respond-to-outreach", () => ({ respondToOutreachAction: vi.fn() }));

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

const SENT = outreachOf("sent");
const APPLY = "/jobs/d0000000-0000-4000-8000-000000000001?apply=true";

const renderForm = (props: Partial<Parameters<typeof RespondForm>[0]> = {}) =>
  render(
    <RespondForm outreachId={SENT.id} companyName="Acme" status="sent" open applyHref={APPLY} {...props} />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RespondForm (ORT-033, OR-TEST-007)", () => {
  it("answers Interested with a note and contact, then shows Apply now", async () => {
    vi.mocked(respondToOutreachAction).mockResolvedValue({ ok: true, outreach: outreachOf("interested") });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Interested" }));
    await user.type(screen.getByLabelText("Note"), "Happy to chat");
    await user.type(screen.getByLabelText("Preferred contact"), "+91 98765 43210");
    await user.click(screen.getByRole("button", { name: "Send my answer" }));

    expect(respondToOutreachAction).toHaveBeenCalledWith({
      outreachId: SENT.id,
      status: "interested",
      reason: null,
      note: "Happy to chat",
      contact: "+91 98765 43210",
      block: false,
    });
    expect(await screen.findByText(/You said you're interested/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apply now/ })).toHaveAttribute("href", APPLY);
    expect(refresh).toHaveBeenCalled();
  });

  it("hides Apply now when the posting has closed", async () => {
    renderForm({ status: "interested", applyHref: null });
    expect(screen.getByText(/You said you're interested/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Apply now/ })).not.toBeInTheDocument();
  });

  it("answers Not interested with a reason and a block", async () => {
    vi.mocked(respondToOutreachAction).mockResolvedValue({ ok: true, outreach: outreachOf("not_interested") });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Not interested" }));
    await user.selectOptions(screen.getByLabelText("Reason"), "compensation");
    await user.click(screen.getByLabelText("Block this company"));
    await user.click(screen.getByRole("button", { name: "Send my answer" }));

    expect(respondToOutreachAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not_interested", reason: "compensation", block: true }),
    );
    expect(await screen.findByText("You said you're not interested.")).toBeInTheDocument();
  });

  it("reports the message", async () => {
    vi.mocked(respondToOutreachAction).mockResolvedValue({ ok: true, outreach: outreachOf("reported") });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /Report/ }));
    await user.type(screen.getByLabelText("Report details"), "Spam");
    await user.click(screen.getAllByRole("button", { name: /Report/ }).at(-1)!);

    expect(respondToOutreachAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: "reported", note: "Spam" }),
    );
    expect(await screen.findByText(/You reported this message/)).toBeInTheDocument();
  });

  it("shows a refusal inline and keeps the form", async () => {
    vi.mocked(respondToOutreachAction).mockResolvedValue({ ok: false, error: "You've already answered this message." });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Interested" }));
    await user.click(screen.getByRole("button", { name: "Send my answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already answered");
    expect(screen.getByRole("button", { name: "Interested" })).toBeInTheDocument();
  });

  it.each([
    ["expired", "This message expired without an answer."],
    ["withdrawn", "The company withdrew this message."],
  ] as const)("shows %s outreach with no form", (status, text) => {
    renderForm({ status, open: false });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Interested" })).not.toBeInTheDocument();
  });

  it("treats a sent message past its expiry as closed", () => {
    renderForm({ status: "sent", open: false });
    expect(screen.getByText("This message expired without an answer.")).toBeInTheDocument();
  });
});

describe("PlainMessage (OR-SEC-002)", () => {
  it("renders HTML and markdown as text and links only https URLs", () => {
    const { container } = render(
      <PlainMessage text={'<img src=x onerror="alert(1)"> [x](javascript:alert(2)) **b**\nSee https://acme.dev/jobs. or http://old.test'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://acme.dev/jobs"]);
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("a")).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("keeps paragraphs", async () => {
    render(<PlainMessage text={"One\n\nTwo"} />);
    await waitFor(() => expect(screen.getByText("Two")).toBeInTheDocument());
    expect(screen.getByText("One").tagName).toBe("P");
  });
});
