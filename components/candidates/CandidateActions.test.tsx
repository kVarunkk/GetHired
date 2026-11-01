import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { deleteCandidatesAction } from "@/app/actions/candidates/delete-candidates";
import CandidateActions from "./CandidateActions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/candidates/delete-candidates", () => ({ deleteCandidatesAction: vi.fn() }));
vi.mock("@/app/actions/candidates/add-candidates-to-job", () => ({ addCandidatesToJobAction: vi.fn() }));

const MEERA = { id: "cc000000-0000-4000-8000-000000000001", name: "Meera Iyer", email: "meera@mail.test" };
const JOBS = [{ id: "b0000000-0000-4000-8000-0000000000a2", title: "Frontend Engineer" }];
const LIST = "/company/candidates";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteCandidatesAction).mockResolvedValue({ ok: true, deleted: 1 });
});

describe("CandidateActions (BI-REQ-005/007)", () => {
  it("opens add to a job", () => {
    render(<CandidateActions candidate={MEERA} jobs={JOBS} canDelete listHref={LIST} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to a job" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("can't add someone without an email", () => {
    render(<CandidateActions candidate={{ ...MEERA, email: null }} jobs={JOBS} canDelete listHref={LIST} />);

    const button = screen.getByRole("button", { name: "Add to a job" });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", "Add an email first");
  });

  it("hides what the member can't do", () => {
    render(<CandidateActions candidate={MEERA} jobs={[]} canDelete={false} listHref={LIST} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("deletes after asking, then goes back to the list", async () => {
    render(<CandidateActions candidate={MEERA} jobs={JOBS} canDelete listHref={LIST} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete Meera Iyer?");
    // BIT-100: a claimed person keeps their applications.
    expect(dialog).toHaveTextContent("If they connected a GetHired account, they keep their applications.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(LIST));
    expect(deleteCandidatesAction).toHaveBeenCalledWith({ candidateIds: [MEERA.id] });
  });

  it("stays put on a refusal", async () => {
    vi.mocked(deleteCandidatesAction).mockResolvedValue({ ok: false, error: "Your role can't import applicants." });
    render(<CandidateActions candidate={MEERA} jobs={JOBS} canDelete listHref={LIST} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't import applicants."));
    expect(push).not.toHaveBeenCalled();
  });
});
