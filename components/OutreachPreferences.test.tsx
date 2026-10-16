import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import {
  setOutreachPreferencesAction,
  unblockCompanyAction,
} from "@/app/actions/outreach/set-outreach-preferences";
import OutreachPreferences from "./OutreachPreferences";

vi.mock("@/app/actions/outreach/set-outreach-preferences", () => ({
  setOutreachPreferencesAction: vi.fn(),
  unblockCompanyAction: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const ACME = { id: "c0000000-0000-4000-8000-000000000001", name: "Acme" };
const GLOBEX = { id: "c0000000-0000-4000-8000-000000000002", name: "Globex" };

const toggle = () => screen.getByRole("switch", { name: /accept outreach/i });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setOutreachPreferencesAction).mockResolvedValue({ ok: true });
  vi.mocked(unblockCompanyAction).mockResolvedValue({ ok: true });
});

describe("OutreachPreferences (ORT-034, OR-REQ-012)", () => {
  it("saves accepts_outreach through the action", async () => {
    render(<OutreachPreferences initialAcceptsOutreach isPublic initialBlocked={[]} />);
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(setOutreachPreferencesAction).toHaveBeenCalledWith({ acceptsOutreach: false });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("rolls back when saving fails", async () => {
    vi.mocked(setOutreachPreferencesAction).mockResolvedValue({ ok: false, error: "Nope." });
    render(<OutreachPreferences initialAcceptsOutreach isPublic initialBlocked={[]} />);

    fireEvent.click(toggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope."));
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  it("is disabled with a note while the profile is private", () => {
    render(<OutreachPreferences initialAcceptsOutreach isPublic={false} initialBlocked={[]} />);

    expect(toggle()).toBeDisabled();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(toggle()).toHaveAccessibleDescription(expect.stringMatching(/make it public/i));
  });

  it("lists blocked companies and unblocks one", async () => {
    render(<OutreachPreferences initialAcceptsOutreach isPublic initialBlocked={[ACME, GLOBEX]} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unblock Acme" }));

    await waitFor(() => expect(screen.queryByText("Acme")).not.toBeInTheDocument());
    expect(unblockCompanyAction).toHaveBeenCalledWith({ companyId: ACME.id });
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  it("keeps the company listed when unblocking fails", async () => {
    vi.mocked(unblockCompanyAction).mockResolvedValue({ ok: false, error: "Try again." });
    render(<OutreachPreferences initialAcceptsOutreach isPublic initialBlocked={[ACME]} />);

    fireEvent.click(screen.getByRole("button", { name: "Unblock Acme" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again."));
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("shows no blocked list when there are none", () => {
    render(<OutreachPreferences initialAcceptsOutreach isPublic initialBlocked={[]} />);

    expect(screen.queryByText("Blocked companies")).not.toBeInTheDocument();
  });
});
