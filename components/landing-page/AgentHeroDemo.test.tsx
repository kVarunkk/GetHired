import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takePendingPrompt } from "@/helpers/agent/prompt-draft";
import AgentHeroDemo from "./AgentHeroDemo";
import { RECRUITER_DEMO } from "./agent-demos";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Signed in unless a test says otherwise.
const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));

describe("AgentHeroDemo", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  });

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

  describe("signed out", () => {
    beforeEach(() => {
      getSession.mockResolvedValue({ data: { session: null } });
    });

    // Not through the agent: the router would cache the middleware's redirect
    // for /agent and replay it after login.
    it("links straight to login, returning to the agent with the prompt", async () => {
      render(<AgentHeroDemo />);

      const suggestions = within(screen.getByRole("group", { name: "Suggested replies" }));
      await waitFor(() =>
        expect(suggestions.getByRole("link", { name: "Save the top two" })).toHaveAttribute(
          "href",
          "/auth/login?returnTo=%2Fagent%3Fprompt%3DSave%2520the%2520top%2520two",
        ),
      );
      expect(screen.getByRole("link", { name: "Memories" })).toHaveAttribute(
        "href",
        "/auth/login?returnTo=%2Fagent",
      );

      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
        target: { value: "Remote Go jobs" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(push).toHaveBeenCalledWith(
        "/auth/login?returnTo=%2Fagent%3Fprompt%3DRemote%2520Go%2520jobs",
      );
      expect(takePendingPrompt()).toBe("Remote Go jobs");
    });

    it("sends the recruiter demo to the company login", async () => {
      render(<AgentHeroDemo demo={RECRUITER_DEMO} />);

      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Memories" })).toHaveAttribute(
          "href",
          "/auth/login?company=true&returnTo=%2Fcompany%2Fagent",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(push).toHaveBeenCalledWith("/auth/login?company=true&returnTo=%2Fcompany%2Fagent");
    });
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
