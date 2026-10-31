import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import {
  removeAgentFeedbackAction,
  submitAgentFeedbackAction,
} from "@/app/actions/submit-agent-feedback";
import type { AgentRoleId } from "@/helpers/agent/roles/types";
import ReplyFeedback, { type ReplyVote } from "./ReplyFeedback";

vi.mock("@/app/actions/submit-agent-feedback", () => ({
  submitAgentFeedbackAction: vi.fn(),
  removeAgentFeedbackAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const SESSION = "55555555-5555-4555-8555-555555555555";
const MESSAGE = "msg-1";

/** Holds the vote the way ChatPane does, and records each change. */
function Harness({
  initial,
  role = "applicant",
  onChange,
}: {
  initial?: ReplyVote;
  role?: AgentRoleId;
  onChange: (value: ReplyVote | undefined) => void;
}) {
  const [value, setValue] = useState<ReplyVote | undefined>(initial);
  return (
    <ReplyFeedback
      sessionId={SESSION}
      messageId={MESSAGE}
      role={role}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

const up = () => screen.getByRole("button", { name: "Good response" });
const down = () => screen.getByRole("button", { name: "Bad response" });

let changes: ReturnType<typeof vi.fn<(value: ReplyVote | undefined) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  changes = vi.fn<(value: ReplyVote | undefined) => void>();
  vi.mocked(submitAgentFeedbackAction).mockResolvedValue({ ok: true });
  vi.mocked(removeAgentFeedbackAction).mockResolvedValue({ ok: true });
});

describe("ReplyFeedback", () => {
  it("saves a 👍 in one click and shows it pressed", async () => {
    render(<Harness onChange={changes} />);
    expect(up()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(up());

    expect(up()).toHaveAttribute("aria-pressed", "true");
    expect(submitAgentFeedbackAction).toHaveBeenCalledWith({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: 1,
    });
    // A 👍 opens nothing.
    expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument();
  });

  it("removes the vote when the pressed button is clicked again", async () => {
    render(<Harness initial={1} onChange={changes} />);

    await userEvent.click(up());

    expect(removeAgentFeedbackAction).toHaveBeenCalledWith({ sessionId: SESSION, messageId: MESSAGE });
    expect(submitAgentFeedbackAction).not.toHaveBeenCalled();
    expect(up()).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the vote with the other button", async () => {
    render(<Harness initial={1} onChange={changes} />);

    await userEvent.click(down());

    expect(submitAgentFeedbackAction).toHaveBeenCalledWith(expect.objectContaining({ rating: -1 }));
    expect(removeAgentFeedbackAction).not.toHaveBeenCalled();
    expect(down()).toHaveAttribute("aria-pressed", "true");
    expect(up()).toHaveAttribute("aria-pressed", "false");
  });

  it("rolls back and toasts when the save is refused", async () => {
    vi.mocked(submitAgentFeedbackAction).mockResolvedValue({
      ok: false,
      error: "That reply is no longer in this chat.",
    });
    render(<Harness onChange={changes} />);

    await userEvent.click(up());

    await waitFor(() => expect(up()).toHaveAttribute("aria-pressed", "false"));
    expect(changes.mock.calls).toEqual([[1], [undefined]]);
    expect(toast.error).toHaveBeenCalledWith("That reply is no longer in this chat.");
  });

  it("rolls back when the action throws", async () => {
    vi.mocked(removeAgentFeedbackAction).mockRejectedValue(new Error("network"));
    render(<Harness initial={-1} onChange={changes} />);

    await userEvent.click(down());

    await waitFor(() => expect(down()).toHaveAttribute("aria-pressed", "true"));
    expect(toast.error).toHaveBeenCalled();
  });

  it("asks what went wrong only after a 👎 is saved", async () => {
    let resolve!: (value: { ok: true }) => void;
    vi.mocked(submitAgentFeedbackAction).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness onChange={changes} />);

    await userEvent.click(down());
    expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument();

    resolve({ ok: true });
    expect(await screen.findByText("What went wrong?")).toBeInTheDocument();
  });

  it("doesn't ask when the 👎 fails to save", async () => {
    vi.mocked(submitAgentFeedbackAction).mockResolvedValue({ ok: false, error: "nope" });
    render(<Harness onChange={changes} />);

    await userEvent.click(down());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument();
  });

  it("offers the applicant's reasons", async () => {
    render(<Harness onChange={changes} />);
    await userEvent.click(down());

    expect(await screen.findByRole("button", { name: "Bad job matches" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bad candidate matches" })).not.toBeInTheDocument();
  });

  it("offers the company's reasons", async () => {
    render(<Harness role="company" onChange={changes} />);
    await userEvent.click(down());

    expect(await screen.findByRole("button", { name: "Bad candidate matches" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bad job matches" })).not.toBeInTheDocument();
  });

  it("submits the reasons and comment to the same row, then thanks without a toast", async () => {
    render(<Harness onChange={changes} />);
    await userEvent.click(down());
    await userEvent.click(await screen.findByRole("button", { name: "Wrong or made-up info" }));
    await userEvent.click(screen.getByRole("button", { name: "Too long" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Anything else?" }), "The salary was wrong");

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitAgentFeedbackAction).toHaveBeenLastCalledWith({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "reply",
      rating: -1,
      reasons: ["wrong_info", "too_long"],
      comment: "The salary was wrong",
    });
    expect(await screen.findByText("Thanks for the feedback")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument());
    expect(toast.success).not.toHaveBeenCalled();
    expect(down()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the bare 👎 and sends nothing more on Esc", async () => {
    render(<Harness onChange={changes} />);
    await userEvent.click(down());
    await screen.findByText("What went wrong?");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument());
    expect(submitAgentFeedbackAction).toHaveBeenCalledTimes(1);
    expect(down()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Thanks for the feedback")).not.toBeInTheDocument();
  });

  it("closes with the × and sends nothing more", async () => {
    render(<Harness onChange={changes} />);
    await userEvent.click(down());

    await userEvent.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByText("What went wrong?")).not.toBeInTheDocument());
    expect(submitAgentFeedbackAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the popover open and toasts when the details fail to save", async () => {
    render(<Harness onChange={changes} />);
    await userEvent.click(down());
    await screen.findByText("What went wrong?");
    vi.mocked(submitAgentFeedbackAction).mockResolvedValue({ ok: false, error: "Try again" });

    await userEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again"));
    expect(screen.getByText("What went wrong?")).toBeInTheDocument();
  });
});
