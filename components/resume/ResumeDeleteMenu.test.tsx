import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteResumeAction } from "@/app/actions/resumes/delete-resume";
import ResumeDeleteMenu from "./ResumeDeleteMenu";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/resumes/delete-resume", () => ({ deleteResumeAction: vi.fn() }));
// Radix menus open on pointer events jsdom doesn't have, so the items render flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled }: { children: ReactNode; onSelect?: () => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));

const RESUME = { id: "r1", name: "Backend" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteResumeAction).mockResolvedValue({ ok: true, reviewsDeleted: 0 });
});

describe("ResumeDeleteMenu (RE-REQ-037)", () => {
  it("deletes once confirmed, then goes back to the list", async () => {
    render(<ResumeDeleteMenu resume={RESUME} deleteBlocked={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete resume" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/resume"));
    expect(deleteResumeAction).toHaveBeenCalledWith({ resumeId: "r1" });
  });

  it("turns Delete off and says why", () => {
    render(<ResumeDeleteMenu resume={RESUME} deleteBlocked="It's your primary resume. Make another one primary first." />);

    const item = screen.getByRole("button", { name: /^Delete/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("It's your primary resume");
  });
});
