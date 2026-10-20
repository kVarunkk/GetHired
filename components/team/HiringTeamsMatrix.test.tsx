import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import { assignJobAction } from "@/app/actions/jobs/assign-job";
import { unassignJobAction } from "@/app/actions/jobs/unassign-job";
import type { HiringTeamsJob, HiringTeamsMember } from "@/helpers/team/list-company-hiring-teams";
import { JOB_A1, JOB_A2 } from "@/test/utils/team";
import HiringTeamsMatrix from "./HiringTeamsMatrix";

vi.mock("@/app/actions/jobs/assign-job", () => ({ assignJobAction: vi.fn() }));
vi.mock("@/app/actions/jobs/unassign-job", () => ({ unassignJobAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const member = (n: number, over: Partial<HiringTeamsMember> = {}): HiringTeamsMember => ({
  userId: `c0000000-0000-4000-8000-00000000000${n}`,
  email: `m${n}@acme.test`,
  name: `Member ${n}`,
  isOwner: false,
  role: { id: "r1", name: "Hiring manager", color: "amber" },
  assignable: true,
  removable: true,
  ...over,
});

const OWNER = member(1, { name: "Olive Owner", isOwner: true, role: null, assignable: false });
const HANA = member(2, { name: "Hana Manager" });
const ADA = member(3, { name: "Ada Admin", assignable: false, removable: false });
const FINN = member(4, { name: "Finn Finance", assignable: false });

const job = (id: string, title: string, over: Partial<HiringTeamsJob> = {}): HiringTeamsJob => ({
  id,
  title,
  status: "active",
  createdAt: "2026-10-01T00:00:00Z",
  assignedUserIds: [],
  ...over,
});

const BACKEND = job(JOB_A1, "Backend Engineer", { assignedUserIds: [HANA.userId, ADA.userId] });
const DESIGNER = job(JOB_A2, "Product Designer", { status: "inactive" });

const renderMatrix = (jobs = [BACKEND, DESIGNER], members = [OWNER, HANA, ADA, FINN]) =>
  render(<HiringTeamsMatrix jobs={jobs} members={members} />);

const cell = (name: string) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HiringTeamsMatrix (RP-REQ-011)", () => {
  it("shows assignable members and anyone already on a job, never owners", () => {
    renderMatrix();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers[0]).toBe("Job");
    expect(headers.slice(1)).toEqual([
      expect.stringContaining("Hana Manager"),
      expect.stringContaining("Ada Admin"),
    ]);
    expect(screen.queryByText("Olive Owner")).toBeNull();
    expect(screen.queryByText("Finn Finance")).toBeNull();
  });

  it("ticks the current assignments and locks what the viewer can't change", () => {
    renderMatrix();
    expect(cell("Hana Manager on Backend Engineer").getAttribute("aria-checked")).toBe("true");
    expect(cell("Hana Manager on Product Designer").getAttribute("aria-checked")).toBe("false");
    expect((cell("Ada Admin on Backend Engineer") as HTMLButtonElement).disabled).toBe(true);
    expect((cell("Ada Admin on Product Designer") as HTMLButtonElement).disabled).toBe(true);
    expect((cell("Hana Manager on Product Designer") as HTMLButtonElement).disabled).toBe(false);
  });

  it("assigns a member to a job", async () => {
    vi.mocked(assignJobAction).mockResolvedValue({ ok: true });
    renderMatrix();

    fireEvent.click(cell("Hana Manager on Product Designer"));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(assignJobAction).toHaveBeenCalledWith({ jobPostId: JOB_A2, userId: HANA.userId });
    expect(toast.success).toHaveBeenCalledWith("Added Hana Manager to Product Designer.");
    expect(cell("Hana Manager on Product Designer").getAttribute("aria-checked")).toBe("true");
  });

  it("unassigns, and rolls back when the server refuses", async () => {
    vi.mocked(unassignJobAction).mockResolvedValue({ ok: false, error: "Your role can't change the hiring team." });
    renderMatrix();

    fireEvent.click(cell("Hana Manager on Backend Engineer"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your role can't change the hiring team."));
    expect(unassignJobAction).toHaveBeenCalledWith({ jobPostId: JOB_A1, userId: HANA.userId });
    expect(cell("Hana Manager on Backend Engineer").getAttribute("aria-checked")).toBe("true");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("filters jobs by title and status", () => {
    renderMatrix();
    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs" }), { target: { value: "design" } });
    expect(screen.queryByText("Backend Engineer")).toBeNull();
    expect(screen.getByText("Product Designer")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.queryByText("Product Designer")).toBeNull();
  });

  it("explains when nobody can be assigned", () => {
    renderMatrix([DESIGNER], [OWNER, FINN]);
    expect(screen.getByText(/Nobody can be assigned to jobs yet/)).toBeTruthy();
  });
});
