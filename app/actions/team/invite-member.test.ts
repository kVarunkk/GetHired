import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, OWNER_A, ROLES_A, inviteOf, memberWith, type MemberFixture } from "@/test/utils/team";
import { sendEmail } from "@/utils/email";
import { PostHogEvent } from "@/utils/types";
import { inviteMemberAction } from "./invite-member";
import { resendInviteAction } from "./resend-invite";
import { revokeInviteAction } from "./revoke-invite";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("server-only", () => ({}));

const INVITE = inviteOf({ email: "priya@gmail.com", role_id: ROLES_A.admin.id });
const INPUT = { email: " Priya@Gmail.com ", roleId: ROLES_A.admin.id } as const;
const ADMIN_ROLE = { id: ROLES_A.admin.id, name: "Admin" };
const SEAT_LIMIT = new EntitlementError({
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
});

let db: SupabaseMock;

async function signInAs(member: MemberFixture | null, user = member?.user) {
  db = createSupabaseMock({ user });
  if (member) db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(user ?? null, db.client);
}

const rpcCalls = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);
const emailed = () => vi.mocked(sendEmail).mock.calls.map(([args]) => args);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(assertLimit).mockResolvedValue(undefined);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await signInAs(OWNER_A);
});

describe("inviteMemberAction (TM-TEST-002)", () => {
  it("refuses a signed-out caller, an applicant and a role without team.invite, without calling the RPC", async () => {
    for (const [member, user] of [
      [null, null],
      [null, mockUser({ type: "applicant" })],
      [MEMBER_A, MEMBER_A.user],
    ] as const) {
      await signInAs(member, user ?? undefined);
      expect(await inviteMemberAction(INPUT)).toMatchObject({ ok: false });
      expect(db.callsFor("create_company_invite")).toHaveLength(0);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("validates the email and the role id, and takes no company (RP-TEST-006)", async () => {
    for (const input of [
      { email: "nope", roleId: ROLES_A.member.id },
      { email: "a@b.co", roleId: "owner" },
      { email: "a@b.co", role: "member" },
      { email: "a@b.co", roleId: ROLES_A.member.id, companyId: COMPANY_A.id },
    ]) {
      expect(await inviteMemberAction(input as never)).toMatchObject({ ok: false });
    }
    expect(db.callsFor("create_company_invite")).toHaveLength(0);
  });

  it("checks the seat limit first and maps it to the plan message (BLT-103)", async () => {
    vi.mocked(assertLimit).mockRejectedValue(SEAT_LIMIT);

    const result = await inviteMemberAction(INPUT);

    expect(assertLimit).toHaveBeenCalledWith(COMPANY_A.id, "seats");
    expect(result).toMatchObject({ ok: false, error: { code: "entitlement", key: "seats" } });
    expect(db.callsFor("create_company_invite")).toHaveLength(0);
  });

  it.each([OWNER_A, ADMIN_A, memberWith(["team.invite"])])(
    "lets a $label with team.invite invite: RPC, then one email with the token",
    async (member) => {
    await signInAs(member);
    db.queueRpc("create_company_invite", {
      data: { ok: true, id: INVITE.row.id, token: INVITE.token, role: ADMIN_ROLE },
      error: null,
    });

    const result = await inviteMemberAction(INPUT);

    expect(result).toEqual({ ok: true, invite: { id: INVITE.row.id, email: "priya@gmail.com", role: ADMIN_ROLE } });
    expect(rpcCalls("create_company_invite")).toEqual([{ p_email: "priya@gmail.com", p_role_id: ROLES_A.admin.id }]);
    expect(emailed()).toHaveLength(1);
    expect(emailed()[0].toEmail).toBe("priya@gmail.com");
    expect(emailed()[0].htmlContent).toContain(`/company/join?token=${INVITE.token}`);
    expect(emailed()[0].htmlContent).toContain("with the Admin role");
  });

  it("leaves the role to the company's default when none is chosen", async () => {
    db.queueRpc("create_company_invite", {
      data: { ok: true, id: INVITE.row.id, token: INVITE.token, role: { id: ROLES_A.member.id, name: "Member" } },
      error: null,
    });

    expect(await inviteMemberAction({ email: "priya@gmail.com" })).toMatchObject({
      ok: true,
      invite: { role: { name: "Member" } },
    });
    expect(rpcCalls("create_company_invite")).toEqual([{ p_email: "priya@gmail.com" }]);
  });

  it("puts the token in the email only: not in the result, the event or the logs (TM-SEC-002)", async () => {
    db.queueRpc("create_company_invite", { data: { ok: true, id: INVITE.row.id, token: INVITE.token }, error: null });
    const log = vi.mocked(console.log);

    const result = await inviteMemberAction(INPUT);

    expect(JSON.stringify(result)).not.toContain(INVITE.token);
    expect(JSON.stringify(vi.mocked(eventCaptureServer).mock.calls)).not.toContain(INVITE.token);
    expect(JSON.stringify([log.mock.calls, vi.mocked(console.error).mock.calls])).not.toContain(INVITE.token);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.TeamMemberInvited,
      distinctId: COMPANY_A.user.id,
    });
  });

  it.each([
    ["already_member", "That person is already on your team."],
    ["already_invited", "That email already has an open invite. Resend it instead."],
    ["seat_limit", "Your plan's seats are all in use. Upgrade to add more."],
    ["above_ceiling", "That includes permissions or limits your own role doesn't have."],
    ["invalid_role", "Choose one of your company's roles."],
    ["something_new", "Something went wrong. Please try again."],
  ])("maps the RPC reason %s", async (reason, error) => {
    db.queueRpc("create_company_invite", { data: { ok: false, reason }, error: null });

    expect(await inviteMemberAction(INPUT)).toEqual({ ok: false, error });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });

  it("says so when the email fails, without logging the token", async () => {
    db.queueRpc("create_company_invite", { data: { ok: true, id: INVITE.row.id, token: INVITE.token }, error: null });
    vi.mocked(sendEmail).mockRejectedValue(new Error(`smtp down ${INVITE.token}`));

    expect(await inviteMemberAction(INPUT)).toEqual({
      ok: false,
      error: "The invite was created but the email didn't send. Resend it.",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(INVITE.token);
  });
});

describe("inviteMemberAction with a role template", () => {
  const NEW_ROLE = { id: "f6000000-0000-4000-8000-000000000001", name: "Recruiter" };

  function queueInvite(role = NEW_ROLE) {
    db.queueRpc("create_company_invite", {
      data: { ok: true, id: INVITE.row.id, token: INVITE.token, role },
      error: null,
    });
  }

  it("creates the role from the template, then invites with it", async () => {
    db.queue("company_roles", { data: null, error: null });
    db.queueRpc("create_company_role", { data: { ok: true, id: NEW_ROLE.id }, error: null });
    queueInvite();

    const result = await inviteMemberAction({ email: "priya@gmail.com", templateKey: "recruiter" });

    expect(result).toMatchObject({ ok: true, invite: { role: NEW_ROLE } });
    const [created] = rpcCalls("create_company_role") as Record<string, unknown>[];
    expect(created).toMatchObject({ p_name: "Recruiter", p_template_key: "recruiter", p_actor_kind: "user" });
    expect(created.p_grants).toEqual(expect.arrayContaining([{ key: "jobs.create", scope: "all" }]));
    expect(rpcCalls("create_company_invite")).toEqual([{ p_email: "priya@gmail.com", p_role_id: NEW_ROLE.id }]);
  });

  it("reuses the company's role from that template when it already has one", async () => {
    db.queue("company_roles", { data: { id: NEW_ROLE.id }, error: null });
    queueInvite();

    expect(await inviteMemberAction({ email: "priya@gmail.com", templateKey: "recruiter" })).toMatchObject({ ok: true });
    expect(db.callsFor("create_company_role")).toHaveLength(0);
    expect(rpcCalls("create_company_invite")).toEqual([{ p_email: "priya@gmail.com", p_role_id: NEW_ROLE.id }]);
  });

  it("needs roles.manage, and refuses a role id together with a template", async () => {
    await signInAs(memberWith(["team.invite"]));
    expect(await inviteMemberAction({ email: "priya@gmail.com", templateKey: "recruiter" })).toMatchObject({ ok: false });

    await signInAs(OWNER_A);
    expect(
      await inviteMemberAction({ email: "priya@gmail.com", roleId: ROLES_A.admin.id, templateKey: "recruiter" }),
    ).toMatchObject({ ok: false });
    expect(db.callsFor("create_company_role")).toHaveLength(0);
    expect(db.callsFor("create_company_invite")).toHaveLength(0);
  });

  it("stops with the role error when the role can't be created", async () => {
    db.queue("company_roles", { data: null, error: null });
    db.queueRpc("create_company_role", { data: { ok: false, reason: "above_ceiling" }, error: null });

    expect(await inviteMemberAction({ email: "priya@gmail.com", templateKey: "recruiter" })).toEqual({
      ok: false,
      error: "That includes permissions or limits your own role doesn't have.",
    });
    expect(db.callsFor("create_company_invite")).toHaveLength(0);
  });
});

describe("revokeInviteAction", () => {
  it("revokes through the RPC, which scopes it to the caller's company", async () => {
    db.queueRpc("revoke_company_invite", { data: { ok: true }, error: null });

    expect(await revokeInviteAction({ inviteId: INVITE.row.id })).toEqual({ ok: true });
    expect(rpcCalls("revoke_company_invite")).toEqual([{ p_invite_id: INVITE.row.id }]);
  });

  it("refuses a member and maps not_found", async () => {
    await signInAs(MEMBER_A);
    expect(await revokeInviteAction({ inviteId: INVITE.row.id })).toMatchObject({ ok: false });
    expect(db.callsFor("revoke_company_invite")).toHaveLength(0);

    await signInAs(OWNER_A);
    db.queueRpc("revoke_company_invite", { data: { ok: false, reason: "not_found" }, error: null });
    expect(await revokeInviteAction({ inviteId: INVITE.row.id })).toEqual({
      ok: false,
      error: "That person, role or invite isn't on your team.",
    });
  });
});

describe("resendInviteAction", () => {
  it("revokes the old invite, then creates a new one with a new token, in that order", async () => {
    const fresh = inviteOf({ email: INVITE.row.email, role_id: ROLES_A.admin.id });
    db.queue("company_invites", {
      data: { id: INVITE.row.id, email: INVITE.row.email, role_id: ROLES_A.admin.id },
      error: null,
    });
    db.queueRpc("revoke_company_invite", { data: { ok: true }, error: null });
    db.queueRpc("create_company_invite", { data: { ok: true, id: fresh.row.id, token: fresh.token }, error: null });

    expect(await resendInviteAction({ inviteId: INVITE.row.id })).toMatchObject({
      ok: true,
      invite: { id: fresh.row.id },
    });

    const order = db.calls.filter((c) => c.kind === "rpc" && c.target !== "my_company_access").map((c) => c.target);
    expect(order).toEqual(["revoke_company_invite", "create_company_invite"]);
    expect(db.callsFor("company_invites")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(emailed()[0].htmlContent).toContain(fresh.token);
    expect(emailed()[0].htmlContent).not.toContain(INVITE.token);
    // The same role goes on the new invite.
    expect(rpcCalls("create_company_invite")).toEqual([{ p_email: INVITE.row.email, p_role_id: ROLES_A.admin.id }]);
  });

  it("refuses an invite from another company (not found under the session company)", async () => {
    db.queue("company_invites", { data: null, error: null });

    expect(await resendInviteAction({ inviteId: INVITE.row.id })).toEqual({
      ok: false,
      error: "That person, role or invite isn't on your team.",
    });
    expect(db.calls.filter((c) => c.kind === "rpc" && c.target !== "my_company_access")).toHaveLength(0);
  });
});
