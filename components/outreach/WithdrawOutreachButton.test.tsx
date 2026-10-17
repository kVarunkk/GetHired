import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { withdrawOutreachAction } from "@/app/actions/outreach/withdraw-outreach";
import WithdrawOutreachButton from "./WithdrawOutreachButton";

vi.mock("@/app/actions/outreach/withdraw-outreach", () => ({ withdrawOutreachAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const OUTREACH_ID = "a1000000-0000-4000-8000-000000000001";

beforeEach(() => vi.clearAllMocks());

describe("WithdrawOutreachButton", () => {
  it("asks before withdrawing", async () => {
    vi.mocked(withdrawOutreachAction).mockResolvedValue({ ok: true });
    render(<WithdrawOutreachButton outreachId={OUTREACH_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(withdrawOutreachAction).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(withdrawOutreachAction).toHaveBeenCalledWith({ outreachId: OUTREACH_ID }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("stays open when withdrawing fails", async () => {
    vi.mocked(withdrawOutreachAction).mockResolvedValue({ ok: false, error: "Only an unanswered message can be withdrawn." });
    render(<WithdrawOutreachButton outreachId={OUTREACH_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(withdrawOutreachAction).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
