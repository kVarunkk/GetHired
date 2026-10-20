import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takePendingPrompt } from "@/helpers/agent/prompt-draft";
import AgentHeroDemo from "./AgentHeroDemo";
import { RECRUITER_DEMO } from "./agent-demos";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("AgentHeroDemo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
    sessionStorage.clear();
  });

  it("renders the sample conversation with the agent's own job results", () => {
    render(<AgentHeroDemo />);

    expect(screen.getByText(/Find remote React jobs that fit my resume/)).toBeInTheDocument();
    expect(screen.getByText("Read your profile")).toBeInTheDocument();
    expect(screen.getByText("Found matching jobs")).toBeInTheDocument();
    expect(screen.getByText("Senior Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText(/Want me to review your resume/)).toBeInTheDocument();
  });

  it("sends suggested replies to the real agent as its first message", () => {
    render(<AgentHeroDemo />);

    const suggestions = within(screen.getByRole("group", { name: "Suggested replies" }));
    const link = suggestions.getByRole("link", { name: "Save the top two" });
    expect(link).toHaveAttribute("href", "/agent?prompt=Save%20the%20top%20two");

    fireEvent.click(link);
    expect(takePendingPrompt()).toBe("Save the top two");
  });

  it("lets the visitor type, and opens the real agent on send", () => {
    render(<AgentHeroDemo />);

    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Remote Go jobs" } });
    expect(box).toHaveValue("Remote Go jobs");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(push).toHaveBeenCalledWith("/agent?prompt=Remote%20Go%20jobs");
    // Kept for the trip through login, which drops the query.
    expect(takePendingPrompt()).toBe("Remote Go jobs");
  });

  it("opens a plain /agent when nothing was typed", () => {
    render(<AgentHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(push).toHaveBeenCalledWith("/agent");
  });

  it("opens the real agent when Enter is pressed", () => {
    render(<AgentHeroDemo />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/agent");
  });

  it("never calls the network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<AgentHeroDemo />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("recruiter demo", () => {
    it("renders the sample shortlist with the agent's own candidate rows", () => {
      render(<AgentHeroDemo demo={RECRUITER_DEMO} />);

      expect(screen.getByText(/Find candidates for my Senior Frontend Engineer post/)).toBeInTheDocument();
      expect(screen.getByText("Read the job post")).toBeInTheDocument();
      expect(screen.getByText("Found matched candidates")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Candidate A/ })).toHaveAttribute("href", "/company/profiles");
      expect(screen.getByText(/Want me to invite them/)).toBeInTheDocument();
    });

    it("sends suggested replies and typed text to the company agent", () => {
      render(<AgentHeroDemo demo={RECRUITER_DEMO} />);

      const suggestions = within(screen.getByRole("group", { name: "Suggested replies" }));
      expect(suggestions.getByRole("link", { name: "Draft a job post" })).toHaveAttribute(
        "href",
        "/company/agent?prompt=Draft%20a%20job%20post",
      );

      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "Find Go engineers" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(push).toHaveBeenCalledWith("/company/agent?prompt=Find%20Go%20engineers");
      expect(takePendingPrompt()).toBe("Find Go engineers");
    });
  });
});
