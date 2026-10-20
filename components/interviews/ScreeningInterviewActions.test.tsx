import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import ScreeningInterviewActions from "./ScreeningInterviewActions";
import { manageScreeningInterviewAction } from "@/app/actions/interviews/manage-screening-interview";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/actions/interviews/manage-screening-interview", () => ({ manageScreeningInterviewAction: vi.fn() }));
vi.mock("./InviteToInterviewDialog", () => ({
  default: ({ open, applicationIds, enabled }: { open: boolean; applicationIds: string[]; enabled?: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Invite dialog">
        {applicationIds.join(",")} {enabled ? "on" : "off"}
      </div>
    ) : null,
}));

type Interview = Parameters<typeof ScreeningInterviewActions>[0]["interview"];
const interview = (overrides: Partial<NonNullable<Interview>> = {}): NonNullable<Interview> => ({
  id: "ai1",
  status: "invited",
  attemptsUsed: 0,
  maxAttempts: 2,
  attemptGranted: false,
  deadlineExtensions: 0,
  hasReport: false,
  ...overrides,
});

const renderActions = (props: Partial<Parameters<typeof ScreeningInterviewActions>[0]> = {}) =>
  render(
    <ScreeningInterviewActions
      applicationId="app1"
      jobPostId="j1"
      candidateName="Ada"
      interview={interview()}
      invite={{ durationMinutes: 15, enabled: true }}
      {...props}
    />,
  );

const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(manageScreeningInterviewAction).mockResolvedValue({ ok: true, status: "invited" });
});

describe("ScreeningInterviewActions (SIT-064, SI-REQ-015/026)", () => {
  it("offers Invite when there's no interview and the job's interview is on", async () => {
    renderActions({ interview: null });
    expect(buttons()).toEqual(["Invite to AI interview"]);
    await userEvent.click(screen.getByRole("button", { name: "Invite to AI interview" }));
    expect(screen.getByRole("dialog", { name: "Invite dialog" })).toHaveTextContent("app1 on");
  });

  it("still offers Invite when the job's interview is off, passing that to the dialog", async () => {
    renderActions({ interview: null, invite: { durationMinutes: 15, enabled: false } });
    await userEvent.click(screen.getByRole("button", { name: "Invite to AI interview" }));
    expect(screen.getByRole("dialog", { name: "Invite dialog" })).toHaveTextContent("app1 off");
  });

  it.each([
    ["invited, not started", interview(), ["Extend deadline", "Cancel interview"]],
    ["invited after a dropped attempt", interview({ attemptsUsed: 1 }), ["Extend deadline", "Grant attempt", "Cancel interview"]],
    ["invited, attempt already granted", interview({ attemptsUsed: 1, attemptGranted: true }), ["Extend deadline", "Cancel interview"]],
    ["paused", interview({ status: "paused" }), ["Extend deadline", "Waive interview", "Cancel interview"]],
    ["in progress", interview({ status: "in_progress", attemptsUsed: 1 }), []],
    ["completed with a report", interview({ status: "completed", attemptsUsed: 1, hasReport: true }), []],
    ["completed incomplete", interview({ status: "completed", attemptsUsed: 2 }), ["Grant attempt"]],
    ["expired", interview({ status: "expired" }), ["Reopen interview"]],
    ["cancelled with attempts left", interview({ status: "cancelled", attemptsUsed: 1 }), ["Reopen interview"]],
    ["cancelled with no attempts left", interview({ status: "cancelled", attemptsUsed: 2 }), []],
  ])("%s shows its actions", (_, value, expected) => {
    renderActions({ interview: value });
    expect(buttons()).toEqual(expected);
  });

  it.each([
    ["cancelled", interview({ status: "cancelled" })],
    ["completed incomplete", interview({ status: "completed", attemptsUsed: 2 })],
  ])("offers nothing for a %s interview in a Rejected or Hired stage", (_, value) => {
    renderActions({ interview: value, stageClosed: true });
    expect(buttons()).toEqual([]);
  });

  it("offers no Invite in a Rejected or Hired stage", () => {
    renderActions({ interview: null, stageClosed: true });
    expect(buttons()).toEqual([]);
  });

  it("hides extend after two extensions", () => {
    renderActions({ interview: interview({ deadlineExtensions: 2 }) });
    expect(buttons()).not.toContain("Extend deadline");
  });

  it("extends by the chosen number of days", async () => {
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Extend deadline" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Extend by"), { target: { value: "7" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Extend" }));

    expect(manageScreeningInterviewAction).toHaveBeenCalledWith({ id: "ai1", action: "extend", days: 7 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it.each([
    ["Cancel interview", "Cancel the interview", "cancel"],
    ["Waive interview", "Waive the interview", "waive"],
    ["Grant attempt", "Grant another attempt", "grant_attempt"],
    ["Reopen interview", "Reopen the interview", "reopen"],
  ])("%s confirms, then calls the action", async (button, confirm, action) => {
    const status = { waive: "paused", reopen: "cancelled" }[action] ?? "invited";
    renderActions({ interview: interview({ status, attemptsUsed: 1 }) });
    await userEvent.click(screen.getByRole("button", { name: button }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: confirm }));

    expect(manageScreeningInterviewAction).toHaveBeenCalledWith({ id: "ai1", action });
  });

  it("shows the action's error", async () => {
    vi.mocked(manageScreeningInterviewAction).mockResolvedValue({ ok: false, error: "That isn't possible at this stage of the interview." });
    renderActions();
    await userEvent.click(screen.getByRole("button", { name: "Cancel interview" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel the interview" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That isn't possible at this stage of the interview."));
  });
});
