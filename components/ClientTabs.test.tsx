import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { ClientTabs, JOB_SEARCH_PROMPT } from "./ClientTabs";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/company/profiles",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("react-transition-progress", () => ({ useProgress: () => vi.fn() }));
// Only the jobs page renders these.
vi.mock("./BookmarkJobSearch", () => ({ default: () => null }));
vi.mock("./JobsPageDropdown", () => ({ default: () => null }));

const USER = { id: "u1" } as User;
const BACKEND = {
  id: "a1000000-0000-4000-8000-00000000000a",
  name: "Backend shortlist",
  slug: "backend-shortlist",
  memberCount: 3,
};
const DESIGN = {
  id: "a1000000-0000-4000-8000-00000000000b",
  name: "Design",
  slug: "design",
  memberCount: 1,
};

const renderTabs = (talentLists = [BACKEND, DESIGN]) =>
  render(
    <ClientTabs
      user={USER}
      isCompanyUser
      isAISearch={false}
      page="profiles"
      talentLists={talentLists}
    >
      <div />
    </ClientTabs>,
  );

const tab = (name: RegExp) => screen.getByRole("tab", { name });

beforeEach(() => {
  vi.clearAllMocks();
  search = "";
});

describe("ClientTabs: talent lists (PL-TASK-051)", () => {
  it("shows each list as a tab after Saved, by name only", () => {
    renderTabs();

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All Profiles",
      "Saved Profiles",
      "Backend shortlist",
      "Design",
    ]);
  });

  it("opens a list as ?tab=<slug>, keeping filters and starting from its first page", async () => {
    search = "tab=saved&cursor=abc&skills=react";
    renderTabs();

    await userEvent.click(tab(/Backend shortlist/));

    expect(push).toHaveBeenCalledWith(
      "/company/profiles?tab=backend-shortlist&skills=react",
    );
  });

  it("marks the list's tab active, and leaves it for another tab", async () => {
    search = "tab=backend-shortlist";
    renderTabs();

    expect(tab(/Backend shortlist/)).toHaveAttribute("data-state", "active");
    expect(tab(/Saved/)).toHaveAttribute("data-state", "inactive");

    await userEvent.click(tab(/Saved/));
    expect(push).toHaveBeenLastCalledWith("/company/profiles?tab=saved");
    await userEvent.click(tab(/All/));
    expect(push).toHaveBeenLastCalledWith("/company/profiles?");
  });

  it("falls back to All for a list that no longer exists", () => {
    search = "tab=old-name";
    renderTabs();

    expect(tab(/All/)).toHaveAttribute("data-state", "active");
  });

  it("puts the tabs in a sideways-scrolling row without a scrollbar", () => {
    renderTabs();

    const row = screen.getByRole("tablist").parentElement!;
    expect(row).toHaveClass("overflow-x-auto", "scrollbar-none");
  });

  it("shows only All and Saved without lists", () => {
    renderTabs([]);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("leaves the jobs page's tabs as they were", () => {
    search = "tab=applied";
    render(
      <ClientTabs
        user={USER}
        isCompanyUser={false}
        isAISearch={false}
        page="jobs"
      >
        <div />
      </ClientTabs>,
    );

    expect(tab(/Applied/)).toHaveAttribute("data-state", "active");
  });
});

describe("ClientTabs: the jobs page's search box", () => {
  const renderJobs = (user: User | null) =>
    render(
      <ClientTabs
        user={user}
        isCompanyUser={false}
        isAISearch={false}
        page="jobs"
      >
        <div />
      </ClientTabs>,
    );

  // Signed-in users get the tab row instead; the box is commented out there.
  it("isn't shown to signed-in users", () => {
    renderJobs(USER);

    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("opens the agent with what was typed (signed out)", async () => {
    renderJobs(null);

    await userEvent.type(
      screen.getByRole("textbox", { name: /What jobs are you looking for/ }),
      "Remote React roles in Bangalore{Enter}",
    );

    expect(push).toHaveBeenCalledWith(
      agentPromptHref("Remote React roles in Bangalore"),
    );
  });

  it("opens the agent with the default job search prompt when sent empty", async () => {
    renderJobs(null);

    await userEvent.click(
      screen.getByRole("button", { name: "Ask the assistant" }),
    );

    expect(push).toHaveBeenCalledWith(agentPromptHref(JOB_SEARCH_PROMPT));
  });
});
