import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyReviewSuggestionsAction } from "@/app/actions/resume-review/apply-suggestions";
import ResumeCheckerHeroDemo from "./ResumeCheckerHeroDemo";
import { DEMO_APPLY_MS } from "./resume-checker-demo";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }),
}));
vi.mock("@/app/actions/resume-review/apply-suggestions", () => ({ applyReviewSuggestionsAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/load-resume-changes", () => ({ loadResumeChangesAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/undo-suggestion", () => ({ undoReviewSuggestionAction: vi.fn() }));

const applyButton = () => screen.getByRole("button", { name: /^Apply \d+ of \d+$/ });

describe("ResumeCheckerHeroDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the agent tailoring a resume, with the changes card under the reply", () => {
    render(<ResumeCheckerHeroDemo />);

    expect(screen.getByText(/Tailor my resume for this Senior Frontend Engineer role/)).toBeInTheDocument();
    expect(screen.getByText("Suggested changes")).toBeInTheDocument();
    expect(screen.getByText("Choose your changes")).toBeInTheDocument();
    expect(screen.getByText(/Led the React and TypeScript component library/)).toBeInTheDocument();
    expect(screen.getByText("Questions for you")).toBeInTheDocument();
  });

  it("leaves a change with values to fill in unticked, and ticks it once they're filled", () => {
    render(<ResumeCheckerHeroDemo />);

    // Six changes, five ticked: the new bullet has [X] and [N].
    expect(applyButton()).toHaveTextContent("Apply 5 of 6");
    fireEvent.change(screen.getByLabelText("Value for [X]"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Value for [N]"), { target: { value: "30" } });
    expect(applyButton()).toHaveTextContent("Apply 6 of 6");
  });

  it("previews the whole resume with the chosen changes", () => {
    render(<ResumeCheckerHeroDemo />);

    expect(screen.getByText("Your resume with these changes")).toBeInTheDocument();
  });

  it("applies locally, never through the server action, and can start over", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ResumeCheckerHeroDemo />);

    fireEvent.click(applyButton());
    await act(() => vi.advanceTimersByTimeAsync(DEMO_APPLY_MS));

    expect(screen.getByText("Reviewed the changes")).toBeInTheDocument();
    expect(screen.getByText(/Applied 5 changes to a copy of your resume/)).toBeInTheDocument();
    expect(applyReviewSuggestionsAction).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try it again" }));
    expect(applyButton()).toHaveTextContent("Apply 5 of 6");
  });

  it("says nothing changed on Discard", () => {
    render(<ResumeCheckerHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
  });
});
