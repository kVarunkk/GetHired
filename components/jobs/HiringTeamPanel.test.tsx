import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { assignJobAction } from "@/app/actions/jobs/assign-job";
import { unassignJobAction } from "@/app/actions/jobs/unassign-job";
import type { HiringTeamMember } from "@/helpers/team/list-job-hiring-team";
import { JOB_A1 } from "@/test/utils/team";
import HiringTeamPanel from "./HiringTeamPanel";

vi.mock("@/app/actions/jobs/assign-job", () => ({ assignJobAction: vi.fn() }));
vi.mock("@/app/actions/jobs/unassign-job", () => ({ unassignJobAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const member = (n: number, over: Partial<HiringTeamMember> = {}): HiringTeamMember => ({
  userId: `c0000000-0000-4000-8000-00000000000${n}`,
  email: `m${n}@acme.test`,
  name: `Member ${n}`,
  isOwner: false,
  role: { id: "r1", name: "Hiring manager", color: "amber" },
  assigned: false,
  assignable: true,
  removable: true,
  ...over,
});

const OWNER = member(1, { name: "Olive Owner", isOwner: true, role: null, assignable: false });
const ASSIGNED = member(2, { name: "Hana Manager", assigned: true });
const LOCKED = member(3, { name: "Ada Admin", assigned: true, removable: false });
const ELIGIBLE = member(4, { name: "Ivy Interviewer" });
const NO_JOB_PERMS = member(5, { name: "Finn Finance", assignable: false });

const renderPanel = (members = [OWNER, ASSIGNED, LOCKED, ELIGIBLE, NO_JOB_PERMS]) =>
  render(<HiringTeamPanel jobPostId={JOB_A1} members={members} />);

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select needs these, and jsdom doesn't have them.
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
});

describe("HiringTeamPanel (RPT-052)", () => {
  it("lists only the assigned members", () => {
    renderPanel();
    const list = screen.getByRole("list", { name: "Assigned members" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Hana Manager"),
      expect.stringContaining("Ada Admin"),
    ]);
    expect(within(list).queryByText("Olive Owner")).toBeNull();
  });

  it("removes a member, and offers no Remove for one above the viewer", async () => {
    vi.mocked(unassignJobAction).mockResolvedValue({ ok: true });
    renderPanel();

    expect(screen.queryByRole("button", { name: "Remove Ada Admin" })).toBeNull();
    expect(screen.getByText("Can't remove")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Hana Manager" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(unassignJobAction).toHaveBeenCalledWith({ jobPostId: JOB_A1, userId: ASSIGNED.userId });
    expect(toast.success).toHaveBeenCalledWith("Removed Hana Manager.");
  });

  it("offers only eligible, unassigned members to add", async () => {
    vi.mocked(assignJobAction).mockResolvedValue({ ok: true });
    renderPanel();

    const add = screen.getByRole("button", { name: /Add to hiring team/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("combobox", { name: "Team member to add" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Ivy Interviewer · Hiring manager"]);

    fireEvent.click(screen.getByRole("option", { name: "Ivy Interviewer · Hiring manager" }));
    fireEvent.click(add);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(assignJobAction).toHaveBeenCalledWith({ jobPostId: JOB_A1, userId: ELIGIBLE.userId });
  });

  it("shows the action's error and doesn't refresh", async () => {
    vi.mocked(unassignJobAction).mockResolvedValue({ ok: false, error: "Your role can't change the hiring team." });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Remove Hana Manager" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't change the hiring team."));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("says so when nobody is assigned or can be added", () => {
    renderPanel([OWNER, NO_JOB_PERMS]);
    expect(screen.getByText("Nobody is assigned to this job yet.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/No one else can be added/)).toBeTruthy();
  });
});
