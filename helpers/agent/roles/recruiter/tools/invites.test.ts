import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { execTool, inputJsonSchema, recruiterToolContext } from "@/test/utils/tools";
import { OWNER_A, ROLES_A, inviteOf, memberWith, type MemberFixture } from "@/test/utils/team";
import { sendEmail } from "@/utils/email";
import { recruiterToolApproval } from "../approval";
import { createRecruiterTools } from "./index";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({
  assertLimit: vi.fn(),
  getEntitlements: vi.fn(async () => ({ entitlements: { seats: { amount: 5 } } })),
}));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));

const INVITE = inviteOf({ email: "priya@acme.dev", role_id: ROLES_A.admin.id });
const ADMIN_ROLE = { id: ROLES_A.admin.id, name: "Admin" };
const INVITE_TOOLS = ["listInvites", "inviteTeamMember", "resendInvite", "revokeInvite"] as const;

let db: SupabaseMock;

type Tools = Record<string, Parameters<typeof execTool>[0]>;
const toolsFor = (member: MemberFixture = OWNER_A) =>
  createRecruiterTools(recruiterToolContext(db.client, { user: member.user, company: member.myCompany })) as Tools;

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);
const decide = (toolName: string) =>
  recruiterToolApproval({
    toolCall: { toolName, toolCallId: "current" },
    messages: [{ role: "user", content: "invite priya" }],
  });

const queueCreated = (role = ADMIN_ROLE) =>
  db.queueRpc("create_company_invite", { data: { ok: true, id: INVITE.row.id, token: INVITE.token, role }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertLimit).mockResolvedValue(undefined);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createSupabaseMock();
});

describe("invite tools (ralph-misc-1 D10)", () => {
  it("takes no company or user id", async () => {
    const tools = toolsFor();
    for (const name of INVITE_TOOLS) {
      expect(JSON.stringify(await inputJsonSchema(tools[name])), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("are left out without team.invite; listing needs team.view only", () => {
    const viewer = Object.keys(toolsFor(memberWith(["team.view"])));
    expect(viewer).toContain("listInvites");
    for (const name of ["inviteTeamMember", "resendInvite", "revokeInvite"]) expect(viewer, name).not.toContain(name);
  });

  it("always ask before inviting, resending or revoking; listing doesn't", () => {
    expect(decide("inviteTeamMember")).toBe("user-approval");
    expect(decide("resendInvite")).toBe("user-approval");
    expect(decide("revokeInvite")).toBe("user-approval");
    expect(decide("listInvites")).not.toBe("user-approval");
  });

  it("invites through the same RPC and email as the team page, marked as the agent's", async () => {
    queueCreated();

    const result = await execTool(toolsFor().inviteTeamMember, { email: " Priya@Acme.dev ", roleId: ROLES_A.admin.id });

    expect(result).toEqual({ invited: "priya@acme.dev", role: "Admin", inviteId: INVITE.row.id, url: "/company/settings/team" });
    expect(rpcArgs("create_company_invite")).toEqual([
      { p_email: "priya@acme.dev", p_role_id: ROLES_A.admin.id, p_actor_kind: "agent" },
    ]);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "priya@acme.dev" }));
    // The token goes only into the email.
    expect(JSON.stringify(result)).not.toContain(INVITE.token);
  });

  it("needs roles.manage to invite with a template", async () => {
    const tools = toolsFor(memberWith(["team.invite"]));

    expect(await execTool(tools.inviteTeamMember, { email: "a@acme.dev", templateKey: "recruiter" })).toEqual({
      error: "Your role doesn't allow this.",
    });
    expect(db.callsFor("create_company_invite")).toHaveLength(0);
    expect(db.callsFor("create_company_role")).toHaveLength(0);
  });

  it("creates the template's role as the agent, then invites with it", async () => {
    const NEW_ROLE = { id: "f6000000-0000-4000-8000-000000000001", name: "Recruiter" };
    db.queue("company_roles", { data: null, error: null });
    db.queueRpc("create_company_role", { data: { ok: true, id: NEW_ROLE.id }, error: null });
    queueCreated(NEW_ROLE);

    expect(await execTool(toolsFor().inviteTeamMember, { email: "a@acme.dev", templateKey: "recruiter" })).toMatchObject({
      role: "Recruiter",
    });
    expect(rpcArgs("create_company_role")[0]).toMatchObject({ p_template_key: "recruiter", p_actor_kind: "agent" });
    expect(rpcArgs("create_company_invite")[0]).toMatchObject({ p_role_id: NEW_ROLE.id });
  });

  it("rejects a bad email, or both a role and a template", async () => {
    const tool = toolsFor().inviteTeamMember;
    await expect(execTool(tool, { email: "nope" })).rejects.toThrow();
    await expect(execTool(tool, { email: "a@acme.dev", roleId: ROLES_A.admin.id, templateKey: "recruiter" })).rejects.toThrow();
  });

  it("explains the RPC's refusal and the seat limit", async () => {
    db.queueRpc("create_company_invite", { data: { ok: false, reason: "already_invited" }, error: null });
    expect(await execTool(toolsFor().inviteTeamMember, { email: "a@acme.dev" })).toEqual({
      error: "That email already has an open invite. Resend it instead.",
    });

    vi.mocked(assertLimit).mockRejectedValue(
      new EntitlementError({
        key: "seats",
        kind: "limit",
        qty: 1,
        used: 2,
        amount: 2,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: { slug: "startup", name: "Startup" },
      }),
    );
    expect(await execTool(toolsFor().inviteTeamMember, { email: "b@acme.dev" })).toMatchObject({ error: "PLAN_LIMIT" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("lists open invites with ids for resend and revoke", async () => {
    db.queueRpc("list_company_team", {
      data: {
        members: [],
        invites: [
          {
            id: INVITE.row.id,
            email: INVITE.row.email,
            role: { id: ROLES_A.admin.id, name: "Admin", color: "slate" },
            invited_by: OWNER_A.user.id,
            created_at: "2026-10-01",
            expires_at: "2026-10-08",
          },
        ],
      },
      error: null,
    });

    expect(await execTool(toolsFor().listInvites, {})).toEqual({
      invites: [{ id: INVITE.row.id, email: "priya@acme.dev", role: "Admin", sentAt: "2026-10-01", expiresAt: "2026-10-08" }],
      seats: { used: 1, limit: 5 },
      url: "/company/settings/team",
    });
  });

  it("resends with a new token and revokes, as the agent", async () => {
    db.queue("company_invites", { data: INVITE.row, error: null });
    db.queueRpc("revoke_company_invite", { data: { ok: true }, error: null });
    queueCreated();
    db.queueRpc("revoke_company_invite", { data: { ok: true }, error: null });

    expect(await execTool(toolsFor().resendInvite, { inviteId: INVITE.row.id })).toMatchObject({ invited: "priya@acme.dev" });
    expect(rpcArgs("create_company_invite")[0]).toEqual({
      p_email: "priya@acme.dev",
      p_role_id: ROLES_A.admin.id,
      p_actor_kind: "agent",
    });

    expect(await execTool(toolsFor().revokeInvite, { inviteId: INVITE.row.id })).toEqual({
      revoked: INVITE.row.id,
      url: "/company/settings/team",
    });
    expect(rpcArgs("revoke_company_invite")).toEqual([
      { p_invite_id: INVITE.row.id, p_actor_kind: "agent" },
      { p_invite_id: INVITE.row.id, p_actor_kind: "agent" },
    ]);
  });

  it("says when the invite isn't open any more", async () => {
    db.queue("company_invites", { data: null, error: null });
    db.queueRpc("revoke_company_invite", { data: { ok: false, reason: "not_found" }, error: null });

    expect(await execTool(toolsFor().resendInvite, { inviteId: INVITE.row.id })).toEqual({
      error: "That person, role or invite isn't on your team.",
    });
    expect(await execTool(toolsFor().revokeInvite, { inviteId: INVITE.row.id })).toEqual({
      error: "That person, role or invite isn't on your team.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
