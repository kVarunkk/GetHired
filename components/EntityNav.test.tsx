import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import EntityNav from "./EntityNav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

const BASE = "/company/job-posts/j1";
const ITEMS = [
  { href: BASE, label: "Overview", exact: true },
  { href: `${BASE}/applications`, label: "Applications" },
];

function renderAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <TooltipProvider>
      <EntityNav label="Job post sections" title="Backend Engineer" backHref="/company/job-posts" backLabel="Job posts" items={ITEMS} />
    </TooltipProvider>,
  );
  // The desktop sidebar; the phone row repeats the same links.
  return screen.getAllByRole("navigation", { name: "Job post sections" })[0];
}

describe("EntityNav", () => {
  it("marks the index section only on its own path", () => {
    const nav = renderAt(`${BASE}/applications`);

    expect(within(nav).getByRole("link", { name: "Applications" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("keeps a section active on the pages under it", () => {
    const nav = renderAt(`${BASE}/applications/board`);

    expect(within(nav).getByRole("link", { name: "Applications" })).toHaveAttribute("aria-current", "page");
  });

  it("links back to the list", () => {
    const nav = renderAt(BASE);

    expect(within(nav).getByRole("link", { name: "Job posts" })).toHaveAttribute("href", "/company/job-posts");
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("has no back link or title on a main page", () => {
    vi.mocked(usePathname).mockReturnValue("/company/settings");
    render(
      <TooltipProvider>
        <EntityNav
          label="Settings sections"
          items={[{ href: "/company/settings", label: "Pipeline", exact: true }]}
        />
      </TooltipProvider>,
    );
    const nav = screen.getAllByRole("navigation", { name: "Settings sections" })[0];

    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    expect(within(nav).queryByText("Acme")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Pipeline" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses to a rail from the toggle at the bottom", () => {
    const nav = renderAt(BASE);

    fireEvent.click(within(nav).getByRole("button", { name: "Collapse sections" }));

    expect(within(nav).getByRole("button", { name: "Expand sections" })).toHaveAttribute("aria-expanded", "false");
    // Labels stay mounted (they fade), so the links keep their names.
    expect(within(nav).getByRole("link", { name: "Applications" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Job posts" })).toHaveAttribute("href", "/company/job-posts");
  });
});
