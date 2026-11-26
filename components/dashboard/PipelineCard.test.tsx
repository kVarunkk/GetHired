import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-hot-toast";
import { setWeeklyApplicationGoalAction } from "@/app/actions/user/set-weekly-application-goal";
import { pipelineOf } from "@/helpers/dashboard/summary";
import { trackerItem } from "@/test/utils/tracker";
import PipelineCard from "./PipelineCard";

vi.mock("@/app/actions/user/set-weekly-application-goal", () => ({ setWeeklyApplicationGoalAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn() } }));

const NOW = new Date("2026-11-25T12:00:00");
const saveGoal = vi.mocked(setWeeklyApplicationGoalAction);

beforeEach(() => {
  vi.clearAllMocks();
  saveGoal.mockResolvedValue({ ok: true });
});

describe("PipelineCard", () => {
  it("shows each column's count and the reply rate", () => {
    const pipeline = pipelineOf(
      [
        trackerItem({ appliedAt: "2026-11-25" }),
        trackerItem({ column: "interviewing", status: "interviewing" }),
        trackerItem({ column: "closed", status: "ghosted" }),
      ],
      NOW,
    );
    render(<PipelineCard pipeline={pipeline} weeklyGoal={5} />);
    expect(screen.getByText("33% got a reply (1 of 3)")).toBeInTheDocument();
    expect(screen.getByText("Interviewing").nextElementSibling?.nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText(/of 5 applications in the last 7 days/)).toBeInTheDocument();
    expect(screen.getByText("4 more to hit your goal.")).toBeInTheDocument();
  });

  it("invites the user to set a goal when none is saved, and saves it", async () => {
    render(<PipelineCard pipeline={pipelineOf([], NOW)} weeklyGoal={null} />);
    expect(screen.getByText(/You haven't applied anywhere in the last 7 days/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set a weekly goal" }));
    fireEvent.click(screen.getByRole("button", { name: "10" }));
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));

    expect(saveGoal).toHaveBeenCalledWith({ goal: 10 });
    expect(await screen.findByText("10 more to hit your goal.")).toBeInTheDocument();
  });

  it("won't save a number out of range", () => {
    render(<PipelineCard pipeline={pipelineOf([], NOW)} weeklyGoal={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Applications per week"), { target: { value: "500" } });
    expect(screen.getByRole("button", { name: "Save goal" })).toBeDisabled();
    expect(screen.getByText(/Pick a whole number/)).toBeInTheDocument();
  });

  it("removes the goal", () => {
    render(<PipelineCard pipeline={pipelineOf([], NOW)} weeklyGoal={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove goal" }));
    expect(saveGoal).toHaveBeenCalledWith({ goal: null });
    expect(screen.getByRole("button", { name: "Set a weekly goal" })).toBeInTheDocument();
  });

  it("puts the old goal back when saving fails", async () => {
    saveGoal.mockResolvedValue({ ok: false, error: "Couldn't save your goal. Please try again." });
    render(<PipelineCard pipeline={pipelineOf([], NOW)} weeklyGoal={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("5 more to hit your goal.")).toBeInTheDocument();
  });
});
