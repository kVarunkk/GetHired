import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { listTalentListsAction } from "@/app/actions/pipeline/list-talent-lists";
import { saveTalentListAction } from "@/app/actions/pipeline/save-talent-list";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import AddToListMenu from "./AddToListMenu";

vi.mock("@/app/actions/pipeline/list-talent-lists", () => ({ listTalentListsAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/save-talent-list", () => ({ saveTalentListAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const BACKEND = { id: "a1000000-0000-4000-8000-00000000000a", name: "Backend", slug: "backend", memberCount: 2, hasCandidate: false };
const DESIGN = { id: "a1000000-0000-4000-8000-00000000000b", name: "Design", slug: "design", memberCount: 1, hasCandidate: true };

async function open() {
  render(<AddToListMenu candidateUserId={PUBLIC_APPLICANT.id} />);
  fireEvent.click(screen.getByRole("button", { name: "Add to list" }));
  await screen.findByRole("button", { name: /Backend/ });
}

// jsdom has no matchMedia. From sm up the menu is a popover, below it a drawer.
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop && query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setViewport(true);
  vi.mocked(listTalentListsAction).mockResolvedValue({ ok: true, lists: [BACKEND, DESIGN] });
  vi.mocked(saveTalentListAction).mockResolvedValue({ ok: true });
});

describe("AddToListMenu (PLT-090)", () => {
  it("loads the company's lists for this candidate when opened", async () => {
    await open();

    expect(listTalentListsAction).toHaveBeenCalledWith({ candidateUserId: PUBLIC_APPLICANT.id });
    expect(screen.getByRole("button", { name: /Backend/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Design/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds to a list and removes from one", async () => {
    await open();

    fireEvent.click(screen.getByRole("button", { name: /Backend/ }));
    await waitFor(() =>
      expect(saveTalentListAction).toHaveBeenCalledWith({
        op: "add",
        listId: BACKEND.id,
        candidateUserId: PUBLIC_APPLICANT.id,
      }),
    );
    expect(screen.getByRole("button", { name: /Backend/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Design/ }));
    await waitFor(() =>
      expect(saveTalentListAction).toHaveBeenCalledWith({
        op: "remove",
        listId: DESIGN.id,
        candidateUserId: PUBLIC_APPLICANT.id,
      }),
    );
  });

  it("creates a list with the candidate in it", async () => {
    vi.mocked(saveTalentListAction).mockResolvedValue({
      ok: true,
      list: { id: "a1000000-0000-4000-8000-00000000000c", company_id: "c", name: "Shortlist", slug: "shortlist", created_at: "" },
    });
    await open();

    fireEvent.change(screen.getByRole("textbox", { name: "New list name" }), { target: { value: "Shortlist" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(saveTalentListAction).toHaveBeenCalledWith({
        op: "create",
        name: "Shortlist",
        candidateUserId: PUBLIC_APPLICANT.id,
      }),
    );
    expect(await screen.findByRole("button", { name: /Shortlist/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("toasts a refusal and leaves the list as it was", async () => {
    vi.mocked(saveTalentListAction).mockResolvedValue({ ok: false, error: "Candidate not found." });
    await open();

    fireEvent.click(screen.getByRole("button", { name: /Backend/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Candidate not found."));
    expect(screen.getByRole("button", { name: /Backend/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers Reach out instead of Add to pipeline, never a fake application (ORT-032)", async () => {
    const onReachOut = vi.fn();
    render(<AddToListMenu candidateUserId={PUBLIC_APPLICANT.id} onReachOut={onReachOut} />);
    fireEvent.click(screen.getByRole("button", { name: /Add to list/ }));
    await waitFor(() => expect(listTalentListsAction).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /Add to pipeline/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reach out/ }));
    expect(onReachOut).toHaveBeenCalledTimes(1);
  });

  it("shows no Reach out without a handler", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /Reach out/ })).not.toBeInTheDocument();
  });
});

describe("AddToListMenu on a phone", () => {
  it("opens a bottom drawer with the same lists", async () => {
    setViewport(false);
    await open();

    expect(screen.getByRole("dialog", { name: "Add to list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Design/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "New list name" })).toBeInTheDocument();
  });
});
