import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { myInterviewTab, type MyInterview } from "@/helpers/interviews/my-interviews-view";
import MyInterviewsTable from "./MyInterviewsTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/company/my-interviews" }));

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function mine(over: Partial<MyInterview> = {}): MyInterview {
  seq += 1;
  return {
    interviewId: `1e000000-0000-4000-8000-00000000000${seq}`,
    applicationId: "ab000000-0000-4000-8000-000000000001",
    jobTitle: "Backend Engineer",
    candidateName: "One",
    name: `Interview ${seq}`,
    status: "scheduled",
    startsAt: iso(NOW + 24 * HOUR),
    endsAt: iso(NOW + 25 * HOUR),
    meetingUrl: null,
    scorecardStatus: "none",
    kitOpen: true,
    ...over,
  };
}

describe("myInterviewTab (IVT-021)", () => {
  it.each([
    ["a future interview", {}, "upcoming"],
    ["a link waiting for the candidate", { status: "awaiting_candidate" as const, startsAt: null, endsAt: null }, "upcoming"],
    ["a finished one without a scorecard", { status: "completed" as const, startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW - HOUR) }, "feedback"],
    ["one in progress", { startsAt: iso(NOW - HOUR / 2), endsAt: iso(NOW + HOUR / 2) }, "feedback"],
    ["a submitted one", { status: "completed" as const, startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW - HOUR), scorecardStatus: "submitted" as const }, "past"],
    ["a closed kit", { status: "completed" as const, startsAt: iso(NOW - 300 * HOUR), endsAt: iso(NOW - 299 * HOUR), kitOpen: false }, "past"],
    ["a cancelled one", { status: "cancelled" as const }, "past"],
    ["a no-show", { status: "no_show" as const, startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW - HOUR) }, "past"],
  ])("%s is %s", (_label, over, tab) => {
    expect(myInterviewTab(mine(over), NOW)).toBe(tab);
  });
});

describe("MyInterviewsTable (IVT-021)", () => {
  it("lists upcoming interviews with a link to the kit", () => {
    const upcoming = mine({ name: "System design" });
    render(<MyInterviewsTable interviews={[upcoming]} />);
    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /System design/ });
    expect(within(row).getByRole("link", { name: "Open kit" })).toHaveAttribute(
      "href",
      `/company/interviews/${upcoming.interviewId}`,
    );
  });

  it("switches to Needs feedback and shows the empty states", () => {
    const now = Date.now();
    render(
      <MyInterviewsTable
        interviews={[mine({ name: "Done", status: "completed", startsAt: iso(now - 2 * HOUR), endsAt: iso(now - HOUR) })]}
      />,
    );
    // Nothing upcoming and something to write: it opens on Needs feedback.
    expect(screen.getByRole("link", { name: "Write scorecard" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Upcoming/ }));
    expect(screen.getByText("No upcoming interviews.")).toBeInTheDocument();
  });

  it("shows nothing to do for an empty list", () => {
    render(<MyInterviewsTable interviews={[]} />);
    expect(screen.getByText("No upcoming interviews.")).toBeInTheDocument();
  });
});
