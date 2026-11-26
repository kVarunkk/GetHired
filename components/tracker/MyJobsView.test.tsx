import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { gethiredItem, savedItem, trackerItem } from "@/test/utils/tracker";
import MyJobsView from "./MyJobsView";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/my-jobs",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/agent/AskAgentOnApplicantPages", () => ({ AskAgentAboutMyJobs: () => <div>agent box</div> }));
vi.mock("./ApplicationsBoard", () => ({ default: ({ items }: { items: unknown[] }) => <div>board of {items.length}</div> }));
vi.mock("./ApplicationsList", () => ({ default: ({ items }: { items: unknown[] }) => <div>list of {items.length}</div> }));
vi.mock("./SavedJobs", () => ({ default: ({ items }: { items: unknown[] }) => <div>saved of {items.length}</div> }));
vi.mock("./KeywordSearch", () => ({ default: () => <input aria-label="Search" /> }));

const applications = [trackerItem(), gethiredItem()];
const saved = [savedItem(), savedItem({ kind: "tracked" } as never), savedItem({ kind: "tracked" } as never)];

const view = (props: Partial<Parameters<typeof MyJobsView>[0]> = {}) =>
  render(
    <MyJobsView
      tab="applications"
      view="board"
      q={null}
      applications={applications}
      saved={saved}
      boardJobs={[]}
      matchedIds={[]}
      {...props}
    />,
  );

beforeEach(() => {
  replace.mockReset();
  search = "";
});

describe("MyJobsView (AT-REQ-013, AT-REQ-027)", () => {
  it("has the title, the agent box and both tabs with their counts", () => {
    view();
    expect(screen.getByRole("heading", { name: "My Jobs" })).toBeTruthy();
    expect(screen.getByText("agent box")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Applications (2)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Saved (3)" })).toBeTruthy();
  });

  it("shows the board by default with the search, and the list for view=list", () => {
    const { unmount } = view();
    expect(screen.getByText("board of 2")).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeTruthy();
    unmount();
    view({ view: "list" });
    expect(screen.getByText("list of 2")).toBeTruthy();
  });

  it("shows no Board | List toggle on the Saved tab", () => {
    view({ tab: "saved" });
    expect(screen.getByText("saved of 3")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Board" })).toBeNull();
  });

  it("keeps the tab and view in the URL", () => {
    search = "q=acme";
    view();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Saved (3)" }));
    expect(replace).toHaveBeenCalledWith("/my-jobs?q=acme&tab=saved", { scroll: false });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "List" }));
    expect(replace).toHaveBeenLastCalledWith("/my-jobs?q=acme&view=list", { scroll: false });
  });

  it("links Add job to its page, as Applied on Applications and as Saved on Saved", () => {
    const { unmount } = view();
    expect(screen.getByRole("link", { name: /Add job/ }).getAttribute("href")).toBe("/my-jobs/add");
    unmount();
    view({ tab: "saved" });
    expect(screen.getByRole("link", { name: /Add job/ }).getAttribute("href")).toBe("/my-jobs/add?status=saved");
  });
});
