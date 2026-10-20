import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import InviteToInterviewDialog from "./InviteToInterviewDialog";
import { inviteToInterviewAction } from "@/app/actions/interviews/invite-to-interview";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/interviews/invite-to-interview", () => ({ inviteToInterviewAction: vi.fn() }));
const handleEntitlement = vi.fn();
vi.mock("@/hooks/useEntitlementError", () => ({
  useEntitlementError: () => ({ handle: handleEntitlement, dialog: <div data-testid="upgrade" /> }),
}));

const JOB = "b2000000-0000-4000-8000-000000000001";
const IDS = ["a1", "a2", "a3"];
const NAMES: Record<string, string> = { a1: "Ada", a2: "Grace", a3: "Alan" };
const onDone = vi.fn();
const onOpenChange = vi.fn();

const renderDialog = (ids = IDS) =>
  render(
    <InviteToInterviewDialog
      open
      onOpenChange={onOpenChange}
      jobPostId={JOB}
      applicationIds={ids}
      nameOf={(id) => NAMES[id]}
      durationMinutes={15}
      onDone={onDone}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  handleEntitlement.mockResolvedValue(false);
});

describe("InviteToInterviewDialog (SIT-062)", () => {
  it("previews the cost before confirming", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Invite 3 applicants to the AI interview" })).toBeInTheDocument();
    expect(screen.getByText(/up to 45 interview minutes/i)).toBeInTheDocument();
    expect(inviteToInterviewAction).not.toHaveBeenCalled();
  });

  it("invites and closes when everyone was invited", async () => {
    vi.mocked(inviteToInterviewAction).mockResolvedValue({ ok: true, invited: 3, skipped: [] });
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Send invites" }));

    expect(inviteToInterviewAction).toHaveBeenCalledWith({ jobPostId: JOB, applicationIds: IDS });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Invited 3 applicants.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("lists who was skipped and why", async () => {
    vi.mocked(inviteToInterviewAction).mockResolvedValue({
      ok: true,
      invited: 1,
      skipped: [
        { id: "a2", reason: "exists", message: "Already invited." },
        { id: "a3", reason: "insufficient_credits", message: "Not enough interview minutes or credits." },
      ],
    });
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Send invites" }));

    expect(await screen.findByText("Invited 1. 2 weren't invited:")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Already invited.")).toBeInTheDocument();
    expect(screen.getByText("Not enough interview minutes or credits.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("opens the upgrade dialog when nobody could be paid for", async () => {
    const entitlement = { ok: false, error: "limit", entitlement: {} } as never;
    vi.mocked(inviteToInterviewAction).mockResolvedValue(entitlement);
    handleEntitlement.mockResolvedValue(true);
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Send invites" }));

    await waitFor(() => expect(handleEntitlement).toHaveBeenCalledWith(entitlement));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows an action error", async () => {
    vi.mocked(inviteToInterviewAction).mockResolvedValue({ ok: false, error: "Your role can't invite." });
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Send invites" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't invite."));
  });

  it("refuses more than 50", () => {
    renderDialog(Array.from({ length: 51 }, (_, i) => `x${i}`));
    expect(screen.getByRole("button", { name: "Send invites" })).toBeDisabled();
    expect(screen.getByText("Invite up to 50 at a time.")).toBeInTheDocument();
  });

  it("points to the job's interview setup while the interview is off, without inviting", () => {
    render(
      <InviteToInterviewDialog
        open
        onOpenChange={onOpenChange}
        jobPostId={JOB}
        applicationIds={IDS}
        durationMinutes={15}
        enabled={false}
      />,
    );
    expect(screen.getByText("Turn on the AI interview first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up the AI interview" })).toHaveAttribute(
      "href",
      `/company/job-posts/${JOB}/interview`,
    );
    expect(screen.queryByRole("button", { name: "Send invites" })).not.toBeInTheDocument();
    expect(inviteToInterviewAction).not.toHaveBeenCalled();
  });
});
