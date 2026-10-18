import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { execTool, inputJsonSchema, recruiterToolContext } from "@/test/utils/tools";
import { JOB_A1, MEMBER_A, OWNER_A, ROLES_A } from "@/test/utils/team";
import { createRoleTools } from "./roles";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({
  getEntitlements: vi.fn(async () => ({ entitlements: { seats: { amount: 5 } } })),
}));

let db: SupabaseMock;
let tools: ReturnType<typeof createRoleTools>;

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const RAW_ROLE = {
  id: ROLES_A.member.id,
  name: "Member",
  description: null,
  color: "slate",
  template_key: "member",
  is_default: true,
  member_count: 2,
  invite_count: 0,
  members: [{ user_id: MEMBER_A.user.id, name: "Max Member" }],
  grants: [
    { key: "jobs.view", scope: "all" },
    { key: "applicants.view", scope: "assigned" },
  ],
  limits: { outreach: 10 },
  updated_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  tools = createRoleTools(recruiterToolContext(db.client, { user: OWNER_A.user, company: OWNER_A.myCompany }));
});

describe("role and team tools (RPT-082, RP-REQ-032)", () => {
  it("has no tool for owners or billing (RP-DEC-003)", () => {
    for (const name of Object.keys(tools)) expect(name).not.toMatch(/owner|billing|primary/i);
  });

  it("takes no company or user id (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("lists roles compactly, with labels and scopes", async () => {
    db.queueRpc("list_company_roles", { data: [RAW_ROLE], error: null });

    const result = (await execTool(tools.listRoles, {})) as { roles: unknown[] };

    expect(result.roles).toEqual([
      expect.objectContaining({
        id: ROLES_A.member.id,
        name: "Member",
        isDefault: true,
        members: 2,
        limits: { outreach: 10 },
        canManage: true,
        permissions: [
          { key: "jobs.view", label: "View job posts", scope: "all jobs" },
          { key: "applicants.view", label: "View applicants", scope: "assigned jobs only" },
        ],
        url: `/company/settings/roles/${ROLES_A.member.id}`,
      }),
    ]);
  });

  it("creates a role through the same RPC as the UI, marked as the agent's", async () => {
    db.queueRpc("create_company_role", { data: { ok: true, id: "r-new" }, error: null });

    expect(
      await execTool(tools.createRole, {
        name: "Interviewer",
        grants: [{ key: "notes.write", scope: "assigned" }],
        limits: { outreach: 0 },
      }),
    ).toEqual({ id: "r-new", name: "Interviewer", url: "/company/settings/roles/r-new" });
    expect(rpcArgs("create_company_role")).toEqual([
      {
        p_name: "Interviewer",
        p_description: "",
        p_color: "slate",
        p_grants: [{ key: "notes.write", scope: "assigned" }],
        p_limits: { outreach: 0 },
        p_actor_kind: "agent",
      },
    ]);
  });

  it("rejects unknown permission keys before the RPC", async () => {
    await expect(execTool(tools.createRole, { name: "X", grants: [{ key: "billing.manage" }] })).rejects.toThrow();
    expect(db.callsFor("create_company_role")).toHaveLength(0);
  });

  it.each([
    ["above_ceiling", "That includes permissions or limits your own role doesn't have."],
    ["own_role", "You can't change your own role or what it allows. Ask someone else on your team."],
  ])("returns the RPC's %s refusal as { error }", async (reason, error) => {
    db.queueRpc("update_company_role", { data: { ok: false, reason }, error: null });

    expect(await execTool(tools.updateRole, { roleId: ROLES_A.member.id, grants: [] })).toEqual({ error });
  });

  it("deletes with a replacement, assigns roles and hiring teams as the agent", async () => {
    db.queueRpc("delete_company_role", { data: { ok: true, moved: 1 }, error: null });
    db.queueRpc("set_company_member_role", { data: { ok: true }, error: null });
    db.queueRpc("assign_job", { data: { ok: true }, error: null });
    db.queueRpc("unassign_job", { data: { ok: true }, error: null });

    await execTool(tools.deleteRole, { roleId: ROLES_A.hiringManager.id, replacementRoleId: ROLES_A.member.id });
    await execTool(tools.assignRole, { memberId: MEMBER_A.user.id, roleId: ROLES_A.admin.id });
    await execTool(tools.assignToJob, { jobPostId: JOB_A1, memberId: MEMBER_A.user.id });
    await execTool(tools.unassignFromJob, { jobPostId: JOB_A1, memberId: MEMBER_A.user.id });

    expect(rpcArgs("delete_company_role")[0]).toMatchObject({ p_replacement_role_id: ROLES_A.member.id, p_actor_kind: "agent" });
    expect(rpcArgs("set_company_member_role")[0]).toEqual({
      p_user_id: MEMBER_A.user.id,
      p_role_id: ROLES_A.admin.id,
      p_actor_kind: "agent",
    });
    expect(rpcArgs("assign_job")[0]).toEqual({ p_job_post_id: JOB_A1, p_user_id: MEMBER_A.user.id, p_actor_kind: "agent" });
    expect(rpcArgs("unassign_job")[0]).toMatchObject({ p_actor_kind: "agent" });
  });

  it("lists the team without emails", async () => {
    db.queueRpc("list_company_team", {
      data: {
        members: [
          {
            user_id: MEMBER_A.user.id,
            email: "member@acme.dev",
            display_name: "Max Member",
            is_owner: false,
            is_primary_owner: false,
            role: { id: ROLES_A.member.id, name: "Member", color: "slate" },
            assigned_job_ids: [JOB_A1],
            joined_at: "2026-01-01",
            last_active_at: null,
          },
        ],
        invites: [],
      },
      error: null,
    });

    const result = await execTool(tools.listTeam, {});

    expect(JSON.stringify(result)).not.toContain("@acme.dev");
    expect(result).toMatchObject({ members: [{ id: MEMBER_A.user.id, name: "Max Member", role: "Member", assignedJobs: 1 }] });
  });
});

describe("hiring team and audit reads", () => {
  it("lists each job's hiring team by name, without emails", async () => {
    db.queueRpc("list_company_hiring_teams", {
      data: {
        jobs: [{ id: JOB_A1, title: "Backend", status: "active", created_at: "2026-10-01", assigned_user_ids: [MEMBER_A.user.id, "gone"] }],
        members: [
          { user_id: MEMBER_A.user.id, email: "member@acme.dev", display_name: "Max Member", is_owner: false, role: { id: ROLES_A.member.id, name: "Member", color: "slate" }, assignable: true, removable: true },
        ],
      },
      error: null,
    });

    const result = await execTool(tools.listHiringTeams, {});

    expect(JSON.stringify(result)).not.toContain("member@acme.dev");
    expect(result).toMatchObject({
      jobs: [{ id: JOB_A1, hiringTeam: [{ id: MEMBER_A.user.id, name: "Max Member" }, { id: "gone", name: "A former member" }] }],
      members: [{ id: MEMBER_A.user.id, role: "Member", canAdd: true, canRemove: true }],
      url: "/company/settings/hiring-teams",
    });
  });

  it("reads the audit log with filters, described in words", async () => {
    db.queueRpc("list_company_audit", {
      data: [
        {
          id: 7,
          actor_user_id: OWNER_A.user.id,
          actor_name: "Olive Owner",
          actor_kind: "agent",
          action: "member.removed",
          target_type: "member",
          target_id: MEMBER_A.user.id,
          target_label: "Max Member",
          before: null,
          after: null,
          created_at: "2026-10-10T10:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await execTool(tools.getAuditLog, { memberId: OWNER_A.user.id, kind: "member", since: "2026-10-01" });

    expect(result).toEqual({
      entries: [{ at: "2026-10-10T10:00:00.000Z", who: "Olive Owner", what: "removed Max Member from the team with the recruiter agent" }],
      more: false,
      url: "/company/settings/audit",
    });
    expect(rpcArgs("list_company_audit")[0]).toMatchObject({
      p_actor: OWNER_A.user.id,
      p_action: "member",
      p_since: "2026-10-01T00:00:00.000Z",
    });
  });

  it("explains a missing permission instead of failing", async () => {
    db.queueRpc("list_company_audit", { data: null, error: null });
    db.queueRpc("list_company_hiring_teams", { data: null, error: null });

    expect(await execTool(tools.getAuditLog, {})).toEqual({ error: "Your role can't read the audit log." });
    expect(await execTool(tools.listHiringTeams, {})).toEqual({ error: "Your role can't change the hiring team." });
  });
});
