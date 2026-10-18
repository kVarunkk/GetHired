import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, ROLES_A, inviteOf, memberWith, type MemberFixture } from "@/test/utils/team";
import { previewAgentRoleAction } from "./preview-agent-role";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({
  getEntitlements: vi.fn(async () => ({ entitlements: { seats: { amount: 5 } } })),
}));
vi.mock("server-only", () => ({}));

const INVITE = inviteOf({ email: "priya@acme.dev", role_id: ROLES_A.admin.id });

const rawRole = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  color: "slate",
  template_key: null,
  is_default: false,
  member_count: 0,
  invite_count: 0,
  members: [],
  grants: [],
  limits: {},
  updated_at: null,
  ...extra,
});

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const ROLES = [
  rawRole(ROLES_A.admin.id, "Admin"),
  rawRole(ROLES_A.member.id, "Member", { is_default: true, template_key: "member" }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previewAgentRoleAction for invites", () => {
  it("shows the email and the chosen, default or template role", async () => {
    const preview = async (input: Record<string, unknown>) => {
      await signInAs(OWNER_A);
      db.queueRpc("list_company_roles", { data: ROLES, error: null });
      return previewAgentRoleAction({ tool: "inviteTeamMember", input });
    };

    expect(await preview({ email: " Priya@Acme.dev ", roleId: ROLES_A.admin.id })).toMatchObject({
      ok: true,
      email: "priya@acme.dev",
      role: { name: "Admin" },
      warning: null,
    });
    expect(await preview({ email: "a@acme.dev" })).toMatchObject({ role: { name: "Member" } });
    expect(await preview({ email: "a@acme.dev", templateKey: "member" })).toMatchObject({ role: { name: "Member" } });
    expect(await preview({ email: "a@acme.dev", templateKey: "recruiter" })).toMatchObject({
      role: { name: "Recruiter (new role)" },
    });
  });

  it("warns when a template invite needs roles.manage", async () => {
    await signInAs(memberWith(["team.invite", "roles.view"]));
    db.queueRpc("list_company_roles", { data: [], error: null });

    expect(
      await previewAgentRoleAction({ tool: "inviteTeamMember", input: { email: "a@acme.dev", templateKey: "recruiter" } }),
    ).toMatchObject({ ok: true, warning: expect.stringMatching(/manage roles/) });
  });

  it("shows the open invite for resend and revoke", async () => {
    await signInAs(OWNER_A);
    db.queueRpc("list_company_roles", { data: ROLES, error: null });
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

    expect(await previewAgentRoleAction({ tool: "revokeInvite", input: { inviteId: INVITE.row.id } })).toMatchObject({
      ok: true,
      email: "priya@acme.dev",
      role: { name: "Admin" },
    });
  });

  it("needs team.invite", async () => {
    await signInAs(MEMBER_A);

    expect(await previewAgentRoleAction({ tool: "inviteTeamMember", input: { email: "a@acme.dev" } })).toMatchObject({
      ok: false,
    });
  });
});

describe("previewAgentRoleAction for setDefaultRole and removeTeamMember (T10.7)", () => {
  it("shows the new and current default role", async () => {
    await signInAs(OWNER_A);
    db.queueRpc("list_company_roles", { data: ROLES, error: null });

    expect(await previewAgentRoleAction({ tool: "setDefaultRole", input: { roleId: ROLES_A.admin.id } })).toMatchObject({
      ok: true,
      role: { name: "Admin" },
      from: "Member",
      warning: null,
    });
  });

  it("says when the role is already the default", async () => {
    await signInAs(OWNER_A);
    db.queueRpc("list_company_roles", { data: ROLES, error: null });

    expect(await previewAgentRoleAction({ tool: "setDefaultRole", input: { roleId: ROLES_A.member.id } })).toMatchObject({
      warning: "This is already the default role.",
    });
  });

  const teamWith = (members: Record<string, unknown>[]) => ({ data: { members, invites: [] }, error: null });
  const rawMember = (member: MemberFixture, name: string, isOwner = false) => ({
    user_id: member.user.id,
    email: null,
    display_name: name,
    is_owner: isOwner,
    is_primary_owner: false,
    role: isOwner ? null : { id: ROLES_A.member.id, name: "Member", color: "slate" },
    joined_at: "2026-10-01",
    last_active_at: null,
  });

  it("shows who is removed and their role, and warns for an owner", async () => {
    await signInAs(OWNER_A);
    db.queueRpc("list_company_team", teamWith([rawMember(MEMBER_A, "Max")]));
    expect(await previewAgentRoleAction({ tool: "removeTeamMember", input: { memberId: MEMBER_A.user.id } })).toMatchObject({
      ok: true,
      member: "Max",
      from: "Member",
      warning: null,
    });

    await signInAs(memberWith(["team.remove"]));
    db.queueRpc("list_company_team", teamWith([rawMember(OWNER_A, "Olivia", true)]));
    expect(await previewAgentRoleAction({ tool: "removeTeamMember", input: { memberId: OWNER_A.user.id } })).toMatchObject({
      from: "Owner",
      warning: "Owners can't be removed by the assistant.",
    });
  });

  it("needs team.remove to preview a removal", async () => {
    await signInAs(MEMBER_A);

    expect(await previewAgentRoleAction({ tool: "removeTeamMember", input: { memberId: OWNER_A.user.id } })).toMatchObject({
      ok: false,
    });
  });
});
