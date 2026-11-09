import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import ImproveResumeLink from "./ImproveResumeLink";

describe("ImproveResumeLink", () => {
  it("opens the agent with the prompt in its message box", () => {
    render(<ImproveResumeLink prompt="Improve my resume." />);

    expect(screen.getByRole("link", { name: "Improve with AI" })).toHaveAttribute(
      "href",
      agentPromptHref("Improve my resume."),
    );
  });
});
