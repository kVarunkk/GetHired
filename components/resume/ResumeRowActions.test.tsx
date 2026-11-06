import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import { deleteResumeAction } from "@/app/actions/resumes/delete-resume";
import { duplicateResumeAction } from "@/app/actions/resumes/duplicate-resume";
import { downloadResume } from "@/helpers/resume/download-resume";
import ResumeRowActions from "./ResumeRowActions";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/resumes/delete-resume", () => ({ deleteResumeAction: vi.fn() }));
vi.mock("@/app/actions/resumes/duplicate-resume", () => ({ duplicateResumeAction: vi.fn() }));
vi.mock("@/helpers/resume/download-resume", () => ({ downloadResume: vi.fn() }));
// Radix menus open on pointer events jsdom doesn't have, so the items render flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    asChild,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    asChild?: boolean;
  }) => (asChild ? children : <button disabled={disabled} onClick={onSelect}>{children}</button>),
}));

const RESUME = { id: "r1", name: "Backend", reviewCount: 0, isUnreadable: false };

const onDeleted = vi.fn();

const open = (resume: Partial<typeof RESUME> = {}, canDelete = true) =>
  render(<ResumeRowActions resume={{ ...RESUME, ...resume }} canDelete={canDelete} onDeleted={onDeleted} />);

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(duplicateResumeAction).mockResolvedValue({ ok: true, resumeId: "copy" });
  vi.mocked(deleteResumeAction).mockResolvedValue({ ok: true, reviewsDeleted: 0 });
  vi.mocked(downloadResume).mockResolvedValue({ ok: true });
});

describe("ResumeRowActions (RE-REQ-030)", () => {
  it("links Edit to the editor", () => {
    open();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/resume/r1/edit");
  });

  it("copies, then opens the copy", async () => {
    open();

    click("Make a copy");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/resume/copy/edit"));
    expect(duplicateResumeAction).toHaveBeenCalledWith({ resumeId: "r1" });
  });

  it("shows a refused copy", async () => {
    vi.mocked(duplicateResumeAction).mockResolvedValue({ ok: false, error: "You can have up to 20 resumes." });
    open();

    click("Make a copy");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can have up to 20 resumes."));
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["Download PDF", "pdf"],
    ["Download Word", "docx"],
  ])("%s downloads", async (name, format) => {
    open();

    click(name);

    await waitFor(() => expect(downloadResume).toHaveBeenCalledWith("r1", format));
  });

  it("shows a refused download", async () => {
    vi.mocked(downloadResume).mockResolvedValue({ ok: false, error: "Download Word instead." });
    open();

    click("Download PDF");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Download Word instead."));
  });

  it("shows only Delete for an old resume that failed", () => {
    open({ isUnreadable: true });

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make a copy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download Word" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});

describe("deleting (RE-REQ-037)", () => {
  it("can't delete the last resume", () => {
    open({}, false);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it.each([
    [0, /^This can't be undone/],
    [1, /Its review will be deleted too/],
    [3, /Its 3 reviews will be deleted too/],
  ])("says what goes with %i reviews", async (reviewCount, text) => {
    open({ reviewCount });

    click("Delete");

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(deleteResumeAction).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    open();

    click("Delete");
    fireEvent.click(await screen.findByRole("button", { name: "Delete resume" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("r1"));
    expect(deleteResumeAction).toHaveBeenCalledWith({ resumeId: "r1" });
  });

  it("does nothing when called off", async () => {
    open();

    click("Delete");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(deleteResumeAction).not.toHaveBeenCalled();
  });

  it("keeps the row when the delete is refused", async () => {
    vi.mocked(deleteResumeAction).mockResolvedValue({ ok: false, error: "You can't delete your only resume." });
    open();

    click("Delete");
    fireEvent.click(await screen.findByRole("button", { name: "Delete resume" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can't delete your only resume."));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
