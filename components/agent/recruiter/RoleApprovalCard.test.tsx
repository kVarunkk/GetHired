import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { previewAgentRoleAction } from "@/app/actions/roles/preview-agent-role";
import { RoleApprovalDetails } from "./RoleApprovalCard";

vi.mock("@/app/actions/roles/preview-agent-role", () => ({ previewAgentRoleAction: vi.fn() }));

const base = { role: null, diff: null, replacement: null, member: null, from: null, to: null, job: null, email: null, warning: null };

describe("RoleApprovalDetails (RP-REQ-032, RPT-082)", () => {
  it("shows the exact grant and limit diff of an updateRole", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({
      ok: true,
      ...base,
      role: { name: "Recruiter", members: 3 },
      diff: {
        grants: [
          { kind: "added", key: "jobs.delete", label: "Delete job posts", scope: "all" },
          { kind: "removed", key: "outreach.send", label: "Send outreach", scope: "all" },
          { kind: "scope", key: "applicants.view", label: "View applicants", from: "all", to: "assigned" },
        ],
        limits: [{ key: "outreach", from: null, to: 50 }],
      },
    });

    render(<RoleApprovalDetails tool="updateRole" input={{ roleId: "r1", grants: [] }} />);

    expect(await screen.findByText("+ Delete job posts (all jobs)")).toBeInTheDocument();
    expect(screen.getByText("− Send outreach")).toBeInTheDocument();
    expect(screen.getByText("View applicants: all jobs → assigned jobs")).toBeInTheDocument();
    expect(screen.getByText("outreach: no limit → 50 a month")).toBeInTheDocument();
    expect(screen.getByText("Recruiter")).toBeInTheDocument();
    expect(previewAgentRoleAction).toHaveBeenCalledWith({ tool: "updateRole", input: { roleId: "r1", grants: [] } });
  });

  it("warns when the change will be refused", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({
      ok: true,
      ...base,
      member: "Max Member",
      from: "Member",
      to: "Admin",
      warning: "That role has permissions yours doesn't, so the change will be refused.",
    });

    render(<RoleApprovalDetails tool="assignRole" input={{ memberId: "u1", roleId: "r2" }} />);

    expect(await screen.findByText(/will be refused/)).toBeInTheDocument();
    expect(screen.getByText("Max Member")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows who an invite goes to and with which role", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({
      ok: true,
      ...base,
      email: "priya@acme.dev",
      role: { name: "Recruiter (new role)", members: 0 },
    });

    render(<RoleApprovalDetails tool="inviteTeamMember" input={{ email: "priya@acme.dev", templateKey: "recruiter" }} />);

    expect(await screen.findByText("priya@acme.dev")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Recruiter (new role)")).toBeInTheDocument();
  });

  it("labels the new and current default role", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({
      ok: true,
      ...base,
      role: { name: "Admin", members: 2 },
      from: "Member",
    });

    render(<RoleApprovalDetails tool="setDefaultRole" input={{ roleId: "r1" }} />);

    expect(await screen.findByText("New default")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Current default")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("shows who a removal takes off the team", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({ ok: true, ...base, member: "Max Member", from: "Member" });

    render(<RoleApprovalDetails tool="removeTeamMember" input={{ memberId: "u1" }} />);

    expect(await screen.findByText("Max Member")).toBeInTheDocument();
    expect(screen.getByText("Current role")).toBeInTheDocument();
  });

  it("shows the preview's error", async () => {
    vi.mocked(previewAgentRoleAction).mockResolvedValue({ ok: false, error: "That role isn't in your company." });

    render(<RoleApprovalDetails tool="deleteRole" input={{ roleId: "x" }} />);

    expect(await screen.findByText("That role isn't in your company.")).toBeInTheDocument();
  });
});
