import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ScorecardForm, { AUTOSAVE_MS, scorecardEditMode, timeLeft, type ScorecardValue } from "./ScorecardForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/interviews/save-scorecard-draft", () => ({ saveScorecardDraftAction: vi.fn() }));
vi.mock("@/app/actions/interviews/submit-scorecard", () => ({ submitScorecardAction: vi.fn() }));

import { saveScorecardDraftAction } from "@/app/actions/interviews/save-scorecard-draft";
import { submitScorecardAction } from "@/app/actions/interviews/submit-scorecard";

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const COMP = { id: "1c000000-0000-4000-8000-0000000000aa", name: "Architecture", description: "Designs systems" };
const NOW = Date.parse("2026-12-01T12:00:00.000Z");

function renderForm(props: Partial<Parameters<typeof ScorecardForm>[0]> = {}) {
  return render(
    <ScorecardForm
      interviewId={INTERVIEW}
      interviewStatus="completed"
      started
      competencies={[COMP]}
      initial={null}
      {...props}
    />,
  );
}

const option = (group: string, label: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: label });

const submitted = (lockedAt: string): ScorecardValue => ({
  status: "submitted",
  overall: "yes",
  overallNote: "Good",
  ratings: { [COMP.id]: { rating: "yes", note: "Clear" } },
  lockedAt,
});

describe("scorecardEditMode / timeLeft (IV-REQ-031, D19)", () => {
  it.each([
    [null, "completed", "draft"],
    [{ status: "draft" as const, lockedAt: null }, "scheduled", "draft"],
    [{ status: "submitted" as const, lockedAt: "2026-12-01T13:00:00.000Z" }, "completed", "notes_only"],
    [{ status: "submitted" as const, lockedAt: "2026-12-01T11:00:00.000Z" }, "completed", "locked"],
    [null, "cancelled", "locked"],
    [{ status: "draft" as const, lockedAt: null }, "no_show", "locked"],
  ])("%o on %s is %s", (card, status, mode) => {
    expect(scorecardEditMode(card, status, NOW)).toBe(mode);
  });

  it("counts down in hours and minutes", () => {
    expect(timeLeft("2026-12-02T09:30:00.000Z", NOW)).toBe("21h 30m");
    expect(timeLeft("2026-12-01T12:05:00.000Z", NOW)).toBe("5m");
  });
});

describe("ScorecardForm (IVT-019)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.mocked(saveScorecardDraftAction).mockResolvedValue({
      ok: true,
      id: "5c",
      applicationId: "a",
      status: "draft",
      updatedAt: "t",
      lockedAt: null,
    });
  });
  afterEach(() => vi.useRealTimers());

  it("autosaves once, a second after the last change", async () => {
    renderForm();
    fireEvent.click(option("Architecture rating", "Strong yes"));
    fireEvent.change(screen.getByLabelText("Architecture notes"), { target: { value: "Solid" } });
    expect(saveScorecardDraftAction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS);
    });

    await waitFor(() => expect(saveScorecardDraftAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveScorecardDraftAction).mock.calls[0][0]).toEqual({
      interviewId: INTERVIEW,
      ratings: { [COMP.id]: { rating: "strong_yes", note: "Solid" } },
      overall: null,
      overallNote: "",
    });
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
  });

  it("Submit needs an overall and a started interview, and confirms that ratings lock", async () => {
    vi.mocked(submitScorecardAction).mockResolvedValue({
      ok: true,
      id: "5c",
      applicationId: "a",
      submittedAt: "s",
      lockedAt: "2026-12-02T12:00:00.000Z",
    });
    renderForm();
    const submit = screen.getByRole("button", { name: "Submit scorecard" });
    expect(submit).toBeDisabled();

    fireEvent.click(option("Overall recommendation", "Yes"));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText(/ratings and recommendation lock when you submit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    // The pending draft is saved first, then submitted.
    await waitFor(() => expect(submitScorecardAction).toHaveBeenCalledWith({ interviewId: INTERVIEW }));
    expect(saveScorecardDraftAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/notes can be edited for 24h 0m/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit scorecard" })).not.toBeInTheDocument();
  });

  it("can't submit before the interview starts", () => {
    renderForm({ started: false, initial: { ...submitted(""), status: "draft", lockedAt: null } });
    expect(screen.getByRole("button", { name: "Submit scorecard" })).toBeDisabled();
    expect(screen.getByText("You can submit once the interview has started.")).toBeInTheDocument();
  });

  it("after submitting, ratings are locked and notes stay editable until locked_at", () => {
    renderForm({ initial: submitted("2026-12-01T20:00:00.000Z") });
    expect(option("Architecture rating", "Strong yes")).toBeDisabled();
    expect(option("Overall recommendation", "No")).toBeDisabled();
    expect(screen.getByLabelText("Architecture notes")).toBeEnabled();
    expect(screen.getByText(/notes can be edited for 8h 0m/)).toBeInTheDocument();
  });

  it("is fully locked after the window", () => {
    renderForm({ initial: submitted("2026-12-01T11:00:00.000Z") });
    expect(screen.getByLabelText("Architecture notes")).toBeDisabled();
    expect(screen.getByLabelText("Overall notes")).toBeDisabled();
    expect(screen.getByText("Submitted and locked.")).toBeInTheDocument();
  });

  it("shows a save refusal", async () => {
    vi.mocked(saveScorecardDraftAction).mockResolvedValue({ ok: false, error: "Your ratings were locked when you submitted." });
    renderForm();
    fireEvent.change(screen.getByLabelText("Overall notes"), { target: { value: "x" } });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your ratings were locked when you submitted.");
  });
});
