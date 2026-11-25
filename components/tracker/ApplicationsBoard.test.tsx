import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import ApplicationsBoard from "./ApplicationsBoard";

vi.mock("@/app/actions/tracker/set-tracked-status", () => ({ setTrackedStatusAction: vi.fn() }));
vi.mock("@/app/actions/tracker/remove-tracked-application", () => ({ removeTrackedApplicationAction: vi.fn() }));
vi.mock("@/app/actions/applications/set-external-application-status", () => ({ setExternalApplicationStatusAction: vi.fn() }));
vi.mock("@/app/actions/applications/remove-external-application", () => ({ removeExternalApplicationAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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

const items = [
  trackerItem({ id: "a1", jobTitle: "Frontend Engineer", companyName: "Acme" }),
  trackerItem({ id: "r1", jobTitle: "Designer", companyName: "Hooli", status: "in_review", statusLabel: "In review", column: "in_review" }),
  trackerItem({ id: "x1", jobTitle: "Analyst", companyName: "Initech", status: "rejected", statusLabel: "Rejected", column: "closed" }),
  gethiredItem({ id: "g1", jobTitle: "Platform Engineer", companyName: "Globex" }),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: true } as never);
});

beforeEach(() => vi.mocked(useMediaQuery).mockReturnValue(true));

describe("ApplicationsBoard on desktop (AT-REQ-014)", () => {

  it("shows five columns with their counts, GetHired cards after tracked ones", () => {
    render(<ApplicationsBoard items={items} />);
    for (const name of ["Applied", "In review", "Interviewing", "Offer", "Closed"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    const applied = screen.getByRole("region", { name: "Applied" });
    const titles = within(applied).getAllByText(/Engineer/).map((node) => node.textContent);
    expect(titles).toEqual(["Frontend Engineer", "Platform Engineer"]);
    expect(screen.getByRole("button", { name: /Closed/ }).parentElement?.textContent).toContain("1");
  });

  it("starts Closed collapsed and opens it on click", () => {
    render(<ApplicationsBoard items={items} />);
    const closed = screen.getByRole("region", { name: "Closed" });
    expect(within(closed).queryByText("Analyst")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
    expect(within(closed).getByText("Analyst")).toBeTruthy();
  });

  it("filters by the keyword", () => {
    render(<ApplicationsBoard items={items} q="hooli" />);
    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.queryByText("Frontend Engineer")).toBeNull();
  });

  it("moves a card from its menu and rolls back with a toast when the save fails", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: false, error: "Nope" } as never);
    render(<ApplicationsBoard items={items} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Applied" })).getAllByRole("button", { name: "Offer" })[0]);
    await waitFor(() => expect(setTrackedStatusAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", status: "offer" })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    expect(within(screen.getByRole("region", { name: "Applied" })).getByText("Frontend Engineer")).toBeTruthy();
  });
});

describe("ApplicationsBoard on mobile (AT-REQ-018)", () => {
  beforeEach(() => vi.mocked(useMediaQuery).mockReturnValue(false));

  it("shows one column at a time through a picker, with no drag handles", () => {
    render(<ApplicationsBoard items={items} />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByLabelText(/^Move Frontend/)).toBeNull();
    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
    expect(screen.queryByText("Designer")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "In review (1)" }));
    fireEvent.click(screen.getByRole("tab", { name: "In review (1)" }));
    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.queryByText("Frontend Engineer")).toBeNull();
  });

  // On a phone a card's menu is a bottom drawer, with Move to… as a group in it.
  const openCardMenu = async (title: string) => {
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
    return within(await screen.findByRole("menu", { name: title }));
  };

  it("says when a column is empty, and moves a card with Move to…", async () => {
    render(<ApplicationsBoard items={items} />);
    const menu = await openCardMenu("Frontend Engineer");
    expect(menu.getByRole("group", { name: "Move to…" })).toBeTruthy();
    fireEvent.click(menu.getByRole("menuitem", { name: "In review" }));
    await waitFor(() => expect(setTrackedStatusAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", status: "in_review" })));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Offer/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Offer/ }));
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });

  it("closes a card with a named outcome from its menu", async () => {
    render(<ApplicationsBoard items={items} />);
    const menu = await openCardMenu("Frontend Engineer");
    fireEvent.click(menu.getByRole("menuitem", { name: "Withdrawn" }));
    await waitFor(() => expect(setTrackedStatusAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", status: "withdrawn" })));
  });
});
