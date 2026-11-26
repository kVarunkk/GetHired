import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import type { AttentionItem } from "@/helpers/dashboard/summary";
import { followUpPrompt } from "@/helpers/tracker/agent-prompts";
import { trackedApplicationPath } from "@/helpers/tracker/paths";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import NeedsAttention, { ATTENTION_LIMIT } from "./NeedsAttention";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("@/app/actions/tracker/set-tracked-status", () => ({ setTrackedStatusAction: vi.fn() }));

let refresh: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ refresh } as never);
  vi.mocked(setTrackedStatusAction).mockReset();
});

describe("NeedsAttention", () => {
  it("offers a drafted follow-up for a due follow-up", () => {
    const item = trackerItem({ jobTitle: "Engineer", companyName: "Acme" });
    render(<NeedsAttention items={[{ item, reason: { kind: "follow_up", due: "2026-11-20", overdue: true } }]} />);

    expect(screen.getByRole("link", { name: "Engineer" })).toHaveAttribute("href", trackedApplicationPath(item.id));
    expect(screen.getByText(/Acme · Follow-up was due Nov 20/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Draft follow-up" })).toHaveAttribute("href", agentPromptHref(followUpPrompt(item)));
    expect(screen.queryByRole("button", { name: "Mark as ghosted" })).not.toBeInTheDocument();
  });

  it("marks a no-reply card as ghosted and drops it", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: true } as never);
    const item = trackerItem({ jobTitle: "Engineer" });
    render(<NeedsAttention items={[{ item, reason: { kind: "no_reply", days: 41 } }]} />);

    expect(screen.getByText(/No reply in 41 days/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark as ghosted" }));

    await waitFor(() => expect(setTrackedStatusAction).toHaveBeenCalledWith({ id: item.id, status: "ghosted" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Engineer" })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the card when marking fails", async () => {
    vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: false, error: "Nope" } as never);
    const item = trackerItem({ jobTitle: "Engineer" });
    render(<NeedsAttention items={[{ item, reason: { kind: "no_reply", days: 41 } }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as ghosted" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark as ghosted" })).toBeEnabled());
    expect(screen.getByRole("link", { name: "Engineer" })).toBeInTheDocument();
  });

  it("links a company's update to the application", () => {
    const item = gethiredItem({ jobTitle: "Designer" });
    render(
      <NeedsAttention items={[{ item, reason: { kind: "update", label: "In review", changedAt: new Date().toISOString() } }]} />,
    );
    expect(screen.getByText(/In review · updated today/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", trackedApplicationPath(item.id));
  });

  it("caps the list and links to the rest", () => {
    const items: AttentionItem[] = Array.from({ length: ATTENTION_LIMIT + 2 }, () => ({
      item: trackerItem(),
      reason: { kind: "no_reply", days: 31 },
    }));
    render(<NeedsAttention items={items} />);
    expect(screen.getAllByRole("button", { name: "Mark as ghosted" })).toHaveLength(ATTENTION_LIMIT);
    expect(screen.getByRole("link", { name: `View all (${ATTENTION_LIMIT + 2})` })).toBeInTheDocument();
  });

  it("says when nothing needs the user", () => {
    render(<NeedsAttention items={[]} />);
    expect(screen.getByText(/Nothing needs you right now/)).toBeInTheDocument();
  });
});
