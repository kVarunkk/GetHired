import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskUserCard, { AskUserResult, type AskUserOutput } from "./AskUserCard";
import type { AskUserInput } from "@/helpers/agent/ask-user";

const INPUT: AskUserInput = {
  questions: [
    {
      question: "Which job should I tailor it for?",
      options: [
        { label: "Frontend Engineer", description: "Acme, Remote" },
        { label: "React Developer" },
      ],
    },
    {
      question: "Which sections do you want?",
      options: [{ label: "Summary" }, { label: "Projects" }, { label: "Skills" }],
      multiSelect: true,
    },
  ],
};

let onComplete: Mock<(output: AskUserOutput) => void>;

beforeEach(() => {
  onComplete = vi.fn();
});

const send = () => screen.getByRole("button", { name: "Send answers" });

describe("AskUserCard", () => {
  it("sends the chosen options once every question is answered", async () => {
    render(<AskUserCard input={INPUT} onComplete={onComplete} />);
    expect(screen.getByText("Acme, Remote")).toBeInTheDocument();
    expect(send()).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /React Developer/ }));
    expect(send()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Summary" }));
    await userEvent.click(screen.getByRole("button", { name: "Skills" }));
    await userEvent.click(send());

    expect(onComplete).toHaveBeenCalledWith({ answers: [{ selected: [1] }, { selected: [0, 2] }] });
  });

  it("lets a typed answer replace a single choice", async () => {
    render(<AskUserCard input={INPUT} onComplete={onComplete} />);

    await userEvent.click(screen.getByRole("radio", { name: /Frontend Engineer/ }));
    await userEvent.type(
      screen.getByLabelText("Your own answer to: Which job should I tailor it for?"),
      "Staff engineer roles",
    );
    expect(screen.getByRole("radio", { name: /Frontend Engineer/ })).toHaveAttribute("aria-checked", "false");
    await userEvent.type(screen.getByLabelText("Your own answer to: Which sections do you want?"), "Awards");
    await userEvent.click(send());

    expect(onComplete).toHaveBeenCalledWith({
      answers: [
        { selected: [], other: "Staff engineer roles" },
        { selected: [], other: "Awards" },
      ],
    });
  });

  it("takes a free answer when there are no options", async () => {
    render(
      <AskUserCard input={{ questions: [{ question: "How many people did you manage?" }] }} onComplete={onComplete} />,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "How many people did you manage?" }), " 5 ");
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));

    expect(onComplete).toHaveBeenCalledWith({ answers: [{ selected: [], other: "5" }] });
  });

  it("can be skipped", async () => {
    render(<AskUserCard input={INPUT} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onComplete).toHaveBeenCalledWith({ dismissed: true });
  });

  it("can't be answered without onComplete", () => {
    render(<AskUserCard input={INPUT} />);
    expect(screen.queryByRole("button", { name: "Send answers" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /React Developer/ })).toBeDisabled();
  });
});

describe("AskUserResult", () => {
  it("shows each question with the user's answers", () => {
    render(
      <AskUserResult input={INPUT} output={{ answers: [{ selected: [0] }, { selected: [1], other: "Awards" }] }} />,
    );
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Projects, Awards")).toBeInTheDocument();
  });
});
