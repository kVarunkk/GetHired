import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { execTool, inputJsonSchema, recruiterToolContext } from "@/test/utils/tools";
import { ADMIN_A, MEMBER_A, OWNER_A, ROLES_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { PostHogEvent } from "@/utils/types";
import { recruiterToolApproval } from "../approval";
import { createRecruiterTools } from "./index";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({
  getEntitlements: vi.fn(async () => ({ entitlements: { seats: { amount: 5 } } })),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const TOOLS = ["removeTeamMember", "setDefaultRole"] as const;

let db: SupabaseMock;

type Tools = Record<string, Parameters<typeof execTool>[0]>;
const toolsFor = (member: MemberFixture = OWNER_A) =>
  createRecruiterTools(recruiterToolContext(db.client, { user: member.user, company: member.myCompany })) as Tools;

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);
const decide = (toolName: string) =>
  recruiterToolApproval({
    toolCall: { toolName, toolCallId: "current" },
    messages: [{ role: "user", content: "remove max" }],
  });

const rawMember = (member: MemberFixture, name: string, isOwner = false) => ({
  user_id: member.user.id,
  email: `${name.toLowerCase()}@acme.dev`,
  display_name: name,
  is_owner: isOwner,
  is_primary_owner: isOwner,
  role: isOwner ? null : { id: ROLES_A.member.id, name: "Member", color: "slate" },
  assigned_job_ids: [],
  joined_at: "2026-10-01",
  last_active_at: null,
});

const queueTeam = () =>
  db.queueRpc("list_company_team", {
    data: { members: [rawMember(OWNER_A, "Olivia", true), rawMember(MEMBER_A, "Max")], invites: [] },
    error: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createSupabaseMock();
});

describe("removeTeamMember and setDefaultRole (ralph-misc-1 T10.7)", () => {
  it("take no company or user id", async () => {
    const tools = toolsFor();
    for (const name of TOOLS) {
      expect(JSON.stringify(await inputJsonSchema(tools[name])), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("are left out without team.remove / roles.manage", () => {
    const viewer = Object.keys(toolsFor(memberWith(["team.view", "roles.view"])));
    for (const name of TOOLS) expect(viewer, name).not.toContain(name);

    expect(Object.keys(toolsFor(memberWith(["team.remove"])))).toContain("removeTeamMember");
    expect(Object.keys(toolsFor(memberWith(["roles.manage"])))).toContain("setDefaultRole");
  });

  it("always ask", () => {
    for (const name of TOOLS) expect(decide(name), name).toBe("user-approval");
  });

  it("removes another member through the same RPC as the team page, marked as the agent's", async () => {
    queueTeam();
    db.queueRpc("remove_company_member", { data: { ok: true }, error: null });

    expect(await execTool(toolsFor().removeTeamMember, { memberId: MEMBER_A.user.id })).toEqual({
      removed: "Max",
      url: "/company/settings/team",
    });
    expect(rpcArgs("remove_company_member")).toEqual([{ p_user_id: MEMBER_A.user.id, p_actor_kind: "agent" }]);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.TeamMemberRemoved,
      distinctId: OWNER_A.user.id,
      properties: { left: false, source: "agent" },
    });
  });

  it("never removes the user themselves or an owner", async () => {
    expect(await execTool(toolsFor(ADMIN_A).removeTeamMember, { memberId: ADMIN_A.user.id })).toMatchObject({
      error: expect.stringContaining("can't remove yourself"),
    });

    queueTeam();
    expect(await execTool(toolsFor(ADMIN_A).removeTeamMember, { memberId: OWNER_A.user.id })).toMatchObject({
      error: expect.stringContaining("Owners can't be removed"),
    });

    queueTeam();
    expect(await execTool(toolsFor().removeTeamMember, { memberId: ADMIN_A.user.id })).toEqual({
      error: "That person isn't on your team.",
    });
    expect(db.callsFor("remove_company_member")).toHaveLength(0);
  });

  it("explains the RPC's refusal", async () => {
    queueTeam();
    db.queueRpc("remove_company_member", { data: { ok: false, reason: "above_ceiling" }, error: null });

    const result = (await execTool(toolsFor().removeTeamMember, { memberId: MEMBER_A.user.id })) as { error?: string };
    expect(result.error).toEqual(expect.any(String));
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });

  it("sets the default role as the agent", async () => {
    db.queueRpc("set_default_company_role", { data: { ok: true }, error: null });

    expect(await execTool(toolsFor().setDefaultRole, { roleId: ROLES_A.admin.id })).toEqual({
      defaultRoleId: ROLES_A.admin.id,
      url: "/company/settings/roles",
    });
    expect(rpcArgs("set_default_company_role")).toEqual([{ p_role_id: ROLES_A.admin.id, p_actor_kind: "agent" }]);
  });

  it("explains a refused default role", async () => {
    db.queueRpc("set_default_company_role", { data: { ok: false, reason: "above_ceiling" }, error: null });

    const result = (await execTool(toolsFor().setDefaultRole, { roleId: ROLES_A.admin.id })) as { error?: string };
    expect(result.error).toEqual(expect.any(String));
  });
});
