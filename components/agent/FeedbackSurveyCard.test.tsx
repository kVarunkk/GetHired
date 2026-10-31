import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { submitAgentFeedbackAction } from "@/app/actions/submit-agent-feedback";
import FeedbackSurveyCard, { type SurveyCardState } from "./FeedbackSurveyCard";

vi.mock("@/app/actions/submit-agent-feedback", () => ({
  submitAgentFeedbackAction: vi.fn(),
  removeAgentFeedbackAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const SESSION = "55555555-5555-4555-8555-555555555555";
const MESSAGE = "msg-1";

function Harness({ initial = "open" as SurveyCardState }) {
  const [state, setState] = useState<SurveyCardState>(initial);
  return (
    <FeedbackSurveyCard sessionId={SESSION} messageId={MESSAGE} role="applicant" state={state} onChange={setState} />
  );
}

const submit = () => screen.getByRole("button", { name: "Submit" });
const rate = (n: number) => userEvent.click(screen.getByRole("radio", { name: `Rate ${n} out of 5` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(submitAgentFeedbackAction).mockResolvedValue({ ok: true });
});

describe("FeedbackSurveyCard", () => {
  it("asks how the agent is working, with the scale's end labels", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "How's the agent working for you?" })).toBeInTheDocument();
    expect(screen.getByText("Not useful")).toBeInTheDocument();
    expect(screen.getByText("Very useful")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("keeps Submit disabled until a rating is chosen", async () => {
    render(<Harness />);
    expect(submit()).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await rate(3);

    expect(submit()).toBeEnabled();
  });

  it("offers what could be better for 1–3, and what went well for 4–5", async () => {
    render(<Harness />);

    await rate(2);
    expect(screen.getByRole("button", { name: "Bad job matches" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saved me time" })).not.toBeInTheDocument();

    await rate(5);
    expect(screen.getByRole("button", { name: "Saved me time" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bad job matches" })).not.toBeInTheDocument();
  });

  it("clears the picked reasons when the rating crosses from negative to positive", async () => {
    render(<Harness />);
    await rate(2);
    await userEvent.click(screen.getByRole("button", { name: "Other" }));
    expect(screen.getByRole("button", { name: "Other" })).toHaveAttribute("aria-pressed", "true");

    await rate(3);
    expect(screen.getByRole("button", { name: "Other" })).toHaveAttribute("aria-pressed", "true");

    await rate(4);
    expect(screen.getByRole("button", { name: "Other" })).toHaveAttribute("aria-pressed", "false");
  });

  it("submits the rating, reasons and comment, then collapses to a thanks line", async () => {
    render(<Harness />);
    await rate(4);
    await userEvent.click(screen.getByRole("button", { name: "Accurate" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Anything else?" }), "Great job matches");

    await userEvent.click(submit());

    expect(submitAgentFeedbackAction).toHaveBeenCalledWith({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "survey",
      rating: 4,
      reasons: ["accurate"],
      comment: "Great job matches",
    });
    expect(await screen.findByText("Thanks — this helps us improve the agent.")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("saves a dismissal and hides the card", async () => {
    const { container } = render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(submitAgentFeedbackAction).toHaveBeenCalledWith({
      sessionId: SESSION,
      messageId: MESSAGE,
      kind: "survey",
      dismissed: true,
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("toasts and keeps the card as it was when saving fails", async () => {
    vi.mocked(submitAgentFeedbackAction).mockResolvedValue({ ok: false, error: "Try again" });
    render(<Harness />);
    await rate(5);

    await userEvent.click(submit());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again"));
    expect(screen.getByRole("heading", { name: "How's the agent working for you?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Rate 5 out of 5" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the card when a dismissal throws", async () => {
    vi.mocked(submitAgentFeedbackAction).mockRejectedValue(new Error("network"));
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "How's the agent working for you?" })).toBeInTheDocument();
  });

  it("renders the thanks line when answered and nothing when dismissed", () => {
    const { rerender, container } = render(<Harness initial="answered" />);
    expect(screen.getByText("Thanks — this helps us improve the agent.")).toBeInTheDocument();

    rerender(
      <FeedbackSurveyCard sessionId={SESSION} messageId="m2" role="applicant" state="dismissed" onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
