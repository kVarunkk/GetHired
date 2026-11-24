import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import TrackerCard, { LOCKED_TOOLTIP, cardHref } from "./TrackerCard";

// Radix menus and tooltips don't open in jsdom: render their content in place.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuPortal: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onClick, asChild }: { children?: ReactNode; onClick?: () => void; asChild?: boolean }) =>
      asChild ? <>{children}</> : <button onClick={onClick}>{children}</button>,
  };
});
vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Tooltip: Pass, TooltipContent: Pass, TooltipProvider: Pass, TooltipTrigger: Pass };
});

const NOW = new Date("2026-12-31T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const render_ = (item: ReturnType<typeof trackerItem>, handlers = { onMove: vi.fn(), onRemove: vi.fn() }) => {
  render(<TrackerCard item={item} now={NOW} {...handlers} />);
  return handlers;
};

describe("TrackerCard: a tracked card (AT-REQ-016)", () => {
  it("shows the company, title, location and source", () => {
    render_(trackerItem({ jobTitle: "Engineer", companyName: "Acme", location: "Pune", source: "extension" }));

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Engineer" })).toBeInTheDocument();
    expect(screen.getByText("Pune")).toBeInTheDocument();
    expect(screen.queryByLabelText(LOCKED_TOOLTIP)).not.toBeInTheDocument();
  });

  it("highlights a follow-up that is due and not one that is ahead", () => {
    const { rerender } = render(<TrackerCard item={trackerItem({ nextFollowUpAt: "2026-12-30" })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTitle("Follow-up due")).toBeInTheDocument();

    rerender(<TrackerCard item={trackerItem({ nextFollowUpAt: "2027-01-10" })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByTitle("Follow-up")).toBeInTheDocument();
  });

  it("shows the outcome as a badge in Closed", () => {
    render_(trackerItem({ status: "rejected", statusLabel: "Rejected", column: "closed" }));
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("moves to a status from the menu, and never offers its own", () => {
    const { onMove } = render_(trackerItem({ status: "applied" }));

    expect(screen.queryByRole("button", { name: "Applied" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Interviewing" }));
    expect(onMove).toHaveBeenCalledWith("interviewing");
  });

  it("removes from the menu and links Edit to the detail page", () => {
    const item = trackerItem();
    const { onRemove } = render_(item);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/my-jobs/applications/${item.id}`);
  });
});

describe("TrackerCard: the ghosted prompt (AT-REQ-017)", () => {
  it("appears after 30 days in Applied or In review, not at 29", () => {
    const { rerender } = render(
      <TrackerCard item={trackerItem({ status: "applied", statusChangedAt: daysAgo(29) })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/Mark as ghosted/)).not.toBeInTheDocument();

    rerender(<TrackerCard item={trackerItem({ status: "applied", statusChangedAt: daysAgo(30) })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mark as ghosted" })).toBeInTheDocument();

    rerender(<TrackerCard item={trackerItem({ status: "in_review", statusChangedAt: daysAgo(45) })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mark as ghosted" })).toBeInTheDocument();
  });

  it("never appears for Interviewing, Offer or a GetHired card", () => {
    const { rerender } = render(
      <TrackerCard item={trackerItem({ status: "interviewing", statusChangedAt: daysAgo(90) })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/Mark as ghosted/)).not.toBeInTheDocument();

    rerender(<TrackerCard item={gethiredItem({ statusChangedAt: daysAgo(90) })} now={NOW} onMove={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByText(/Mark as ghosted/)).not.toBeInTheDocument();
  });

  it("moves the card to ghosted on click", () => {
    const { onMove } = render_(trackerItem({ status: "applied", statusChangedAt: daysAgo(31) }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as ghosted" }));
    expect(onMove).toHaveBeenCalledWith("ghosted");
  });
});

describe("TrackerCard: a GetHired card (AT-REQ-022)", () => {
  const item = gethiredItem({ id: "g1", allJobsId: "job-1", screeningInterviewId: "si-1" });

  it("is locked with a tooltip and has no move or remove", () => {
    render_(item);

    expect(screen.getByLabelText(LOCKED_TOOLTIP)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByText("Move to…")).not.toBeInTheDocument();
  });

  it("offers View job, a note and the AI interview", () => {
    render_(item);

    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute("href", "/jobs/job-1");
    expect(screen.getByRole("link", { name: "Add a note or follow-up" })).toHaveAttribute("href", "/my-jobs/applications/g1");
    expect(screen.getByRole("link", { name: "Open AI interview" })).toHaveAttribute("href", "/interview/screening/si-1");
  });

  it("shows On hold for a stand-by application", () => {
    render_(gethiredItem({ onHold: true }));
    expect(screen.getByText("On hold")).toBeInTheDocument();
  });
});

describe("cardHref", () => {
  it("opens a legacy row's board job, and any other card's page", () => {
    expect(cardHref(trackerItem({ id: "t1", legacy: true, allJobsId: "job-1" }))).toBe("/jobs/job-1");
    expect(cardHref(trackerItem({ id: "t1" }))).toBe("/my-jobs/applications/t1");
  });
});
