import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { removeTrackedApplicationAction } from "@/app/actions/tracker/remove-tracked-application";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { updateTrackedApplicationAction } from "@/app/actions/tracker/update-tracked-application";
import { saveApplicationNoteAction } from "@/app/actions/tracker/save-application-note";
import { gethiredItem } from "@/test/utils/tracker";
import GetHiredDetail from "./GetHiredDetail";
import TrackedDetail, { type TrackedDetailRow } from "./TrackedDetail";

vi.mock("@/app/actions/tracker/remove-tracked-application", () => ({ removeTrackedApplicationAction: vi.fn() }));
vi.mock("@/app/actions/tracker/set-tracked-status", () => ({ setTrackedStatusAction: vi.fn() }));
vi.mock("@/app/actions/tracker/update-tracked-application", () => ({ updateTrackedApplicationAction: vi.fn() }));
vi.mock("@/app/actions/tracker/save-application-note", () => ({ saveApplicationNoteAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/responsive-select", () => import("@/test/utils/select-mock"));
vi.mock("@/components/ConfirmDialog", () => ({
  default: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => void; confirmLabel: string }) =>
    open ? <button onClick={onConfirm}>{`Confirm ${confirmLabel}`}</button> : null,
}));

const row: TrackedDetailRow = {
  id: "t1",
  allJobsId: null,
  jobTitle: "Designer",
  companyName: "Hooli",
  jobUrl: "https://jobs.lever.co/hooli/1",
  location: "Berlin",
  jobDescription: null,
  status: "applied",
  appliedAt: "2026-11-17",
  nextFollowUpAt: null,
  notes: "Referred by Sam",
  contactName: null,
  resumeId: null,
  salaryAmount: 90000,
  salaryCurrency: "EUR",
};
const events = [
  { id: "e1", kind: "created" as const, fromStatus: null, toStatus: "applied" as const, createdAt: "2026-11-17T10:00:00.000Z" },
  { id: "e2", kind: "status" as const, fromStatus: "applied" as const, toStatus: "interviewing" as const, createdAt: "2026-11-20T10:00:00.000Z" },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateTrackedApplicationAction).mockResolvedValue({ ok: true } as never);
  vi.mocked(setTrackedStatusAction).mockResolvedValue({ ok: true } as never);
  vi.mocked(removeTrackedApplicationAction).mockResolvedValue({ ok: true } as never);
  vi.mocked(saveApplicationNoteAction).mockResolvedValue({ ok: true } as never);
});

describe("TrackedDetail (AT-REQ-023)", () => {
  it("shows the actions, the salary and the timeline", () => {
    render(<TrackedDetail row={row} events={events} resumes={[]} />);
    expect(screen.getByRole("link", { name: /Open posting/ }).getAttribute("href")).toBe("https://jobs.lever.co/hooli/1");
    expect(screen.getByRole("link", { name: "Tailor resume" }).getAttribute("href")).toMatch(/^\/agent\?prompt=/);
    expect(screen.getByText(/90,000 EUR a year/)).toBeTruthy();
    expect(screen.getByText("Added as Applied")).toBeTruthy();
    expect(screen.getByText("Moved to Interviewing")).toBeTruthy();
  });

  it("hides Practice interview for a job added by hand, and shows it for a GetHired job", () => {
    const { unmount } = render(<TrackedDetail row={row} events={events} resumes={[]} />);
    expect(screen.queryByRole("link", { name: "Practice interview" })).toBeNull();
    unmount();
    render(<TrackedDetail row={{ ...row, allJobsId: "job-1" }} events={events} resumes={[]} />);
    const href = screen.getByRole("link", { name: "Practice interview" }).getAttribute("href") ?? "";
    expect(href).toMatch(/^\/agent\?prompt=/);
    expect(decodeURIComponent(href)).toContain("(/jobs/job-1)");
  });

  it("saves edited fields, and a changed status through setTrackedStatusAction", async () => {
    render(<TrackedDetail row={row} events={events} resumes={[]} />);
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Hooli Inc" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "offer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
    expect(updateTrackedApplicationAction).toHaveBeenCalledWith("t1", expect.objectContaining({ companyName: "Hooli Inc", jobTitle: "Designer" }));
    expect(setTrackedStatusAction).toHaveBeenCalledWith({ id: "t1", status: "offer" });
  });

  it("shows a GetHired job's title, company and place as fixed, and sends only the rest", async () => {
    render(<TrackedDetail row={{ ...row, allJobsId: "job-1" }} events={events} resumes={[]} />);
    expect(screen.queryByLabelText("Job title")).toBeNull();
    expect(screen.queryByLabelText("Company")).toBeNull();
    expect(screen.getByRole("link", { name: "Open the job" }).getAttribute("href")).toBe("/jobs/job-1");
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Heard back" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateTrackedApplicationAction).toHaveBeenCalled());
    const sent = vi.mocked(updateTrackedApplicationAction).mock.calls[0][1];
    expect(sent).not.toHaveProperty("jobTitle");
    expect(sent).toMatchObject({ notes: "Heard back" });
  });

  it("does not move the status when only a field changed", async () => {
    render(<TrackedDetail row={row} events={events} resumes={[]} />);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Heard back" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateTrackedApplicationAction).toHaveBeenCalled());
    expect(setTrackedStatusAction).not.toHaveBeenCalled();
  });

  it("reports a failed save and skips the status move", async () => {
    vi.mocked(updateTrackedApplicationAction).mockResolvedValue({ ok: false, error: "Nope" } as never);
    render(<TrackedDetail row={row} events={events} resumes={[]} />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "offer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    expect(setTrackedStatusAction).not.toHaveBeenCalled();
  });

  it("never offers Saved to an applied card, but does to a saved one", () => {
    const { unmount } = render(<TrackedDetail row={row} events={events} resumes={[]} />);
    expect(screen.getByLabelText("Status").innerHTML).not.toContain("Saved");
    unmount();
    render(<TrackedDetail row={{ ...row, status: "saved", appliedAt: null }} events={events} resumes={[]} />);
    expect(screen.getByLabelText("Status").innerHTML).toContain("Saved");
    expect(screen.queryByLabelText("Applied on")).toBeNull();
  });

  it("removes after confirming and goes back to the list", async () => {
    render(<TrackedDetail row={row} events={events} resumes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));
    await waitFor(() => expect(removeTrackedApplicationAction).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/my-jobs"));
  });
});

describe("GetHiredDetail (AT-REQ-023, AT-REQ-039)", () => {
  const item = gethiredItem({ id: "app1", allJobsId: "job-1", statusLabel: "In review", notes: "Ask about team", screeningInterviewId: "si-1" });

  it("is read-only apart from the private note, with the job and interview links", () => {
    render(<GetHiredDetail item={item} />);
    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.getByText("The company updates this status.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View job" }).getAttribute("href")).toBe("/jobs/job-1");
    expect(screen.getByRole("link", { name: "Open AI interview" }).getAttribute("href")).toBe("/interview/screening/si-1");
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Ask about team");
  });

  it("saves the note and the follow-up for the application", async () => {
    render(<GetHiredDetail item={item} />);
    fireEvent.change(screen.getByLabelText("Follow up on"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(saveApplicationNoteAction).toHaveBeenCalledWith({ applicationId: "app1", notes: "Ask about team", nextFollowUpAt: "2026-12-01" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a failed save", async () => {
    vi.mocked(saveApplicationNoteAction).mockResolvedValue({ ok: false, error: "Application not found." } as never);
    render(<GetHiredDetail item={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Application not found."));
  });
});
