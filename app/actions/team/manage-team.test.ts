import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  ADMIN_A,
  MEMBER_A,
  MEMBER_B,
  OWNER_A,
  ROLES_A,
  memberOf,
  memberWith,
  type MemberFixture,
} from "@/test/utils/team";
import { PostHogEvent } from "@/utils/types";
import { changeRoleAction } from "./change-role";
import { makePrimaryOwnerAction } from "./make-primary-owner";
import { removeMemberAction } from "./remove-member";
import { setOwnerAction } from "./set-owner";
import { updateDisplayNameAction } from "./update-display-name";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);
const CO_OWNER = memberOf(COMPANY_A, "custom", { isOwner: true });

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("changeRoleAction (RP-REQ-007, RP-TEST-006)", () => {
  it("refuses a role without team.assign_roles before the RPC", async () => {
    await signInAs(MEMBER_A);

    expect(await changeRoleAction({ userId: ADMIN_A.user.id, roleId: ROLES_A.member.id })).toEqual({
      ok: false,
      error: "Your role can't change members' roles.",
    });
    expect(db.callsFor("set_company_member_role")).toHaveLength(0);
  });

  it("validates the ids with zod and takes nothing else", async () => {
    expect(await changeRoleAction({ userId: "nope", roleId: ROLES_A.admin.id })).toMatchObject({ ok: false });
    expect(await changeRoleAction({ userId: MEMBER_A.user.id, roleId: "admin" })).toMatchObject({ ok: false });
    expect(
      await changeRoleAction({ userId: MEMBER_A.user.id, roleId: ROLES_A.admin.id, companyId: COMPANY_A.id } as never),
    ).toMatchObject({ ok: false });
    expect(db.callsFor("set_company_member_role")).toHaveLength(0);
  });

  it("lets a custom role with team.assign_roles through to the RPC", async () => {
    await signInAs(memberWith(["team.assign_roles"]));
    db.queueRpc("set_company_member_role", { data: { ok: true }, error: null });

    expect(await changeRoleAction({ userId: MEMBER_A.user.id, roleId: ROLES_A.member.id })).toEqual({ ok: true });
  });

  it("sends the target and the role id to the RPC, which resolves both in the caller's company", async () => {
    db.queueRpc("set_company_member_role", { data: { ok: true }, error: null });

    expect(await changeRoleAction({ userId: MEMBER_A.user.id, roleId: ROLES_A.admin.id })).toEqual({ ok: true });
    expect(rpcArgs("set_company_member_role")).toEqual([
      { p_user_id: MEMBER_A.user.id, p_role_id: ROLES_A.admin.id },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/team");
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/roles");
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: PostHogEvent.TeamRoleChanged }));
  });

  it.each([
    ["not_found", "That person, role or invite isn't on your team."],
    ["owner", "Only owners can change another owner."],
    ["above_ceiling", "That includes permissions or limits your own role doesn't have."],
    ["own_role", "You can't change your own role or what it allows. Ask someone else on your team."],
    ["invalid_role", "Choose one of your company's roles."],
  ])("maps %s", async (reason, message) => {
    db.queueRpc("set_company_member_role", { data: { ok: false, reason }, error: null });

    expect(await changeRoleAction({ userId: MEMBER_B.user.id, roleId: ROLES_A.admin.id })).toEqual({
      ok: false,
      error: message,
    });
  });
});

describe("removeMemberAction (TM-REQ-007, RP-REQ-006)", () => {
  it("lets a role with team.remove remove a member, signing nobody out", async () => {
    await signInAs(ADMIN_A);
    db.queueRpc("remove_company_member", { data: { ok: true }, error: null });

    expect(await removeMemberAction({ userId: MEMBER_A.user.id })).toEqual({ ok: true, left: false });
    expect(rpcArgs("remove_company_member")).toEqual([{ p_user_id: MEMBER_A.user.id }]);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.TeamMemberRemoved,
      distinctId: ADMIN_A.user.id,
      properties: { left: false },
    });
    expect(db.calls.some((c) => c.target.includes("sign"))).toBe(false);
  });

  it("refuses removing someone else without team.remove, before the RPC", async () => {
    await signInAs(MEMBER_A);

    expect(await removeMemberAction({ userId: ADMIN_A.user.id })).toEqual({
      ok: false,
      error: "Your role can't remove members.",
    });
    expect(db.callsFor("remove_company_member")).toHaveLength(0);
  });

  it("lets anyone leave", async () => {
    await signInAs(MEMBER_A);
    db.queueRpc("remove_company_member", { data: { ok: true }, error: null });

    expect(await removeMemberAction({ userId: MEMBER_A.user.id })).toEqual({ ok: true, left: true });
  });

  it.each([
    ["primary_owner", "The primary owner can't do this. Make another owner primary first."],
    ["owner", "Only owners can change another owner."],
    ["above_ceiling", "That includes permissions or limits your own role doesn't have."],
  ])("maps %s", async (reason, message) => {
    db.queueRpc("remove_company_member", { data: { ok: false, reason }, error: null });

    expect(await removeMemberAction({ userId: OWNER_A.user.id })).toEqual({ ok: false, error: message });
  });
});

describe("setOwnerAction (RPT-041, RP-REQ-006)", () => {
  it.each([ADMIN_A, MEMBER_A])("is for owners only, not the $label role", async (member) => {
    await signInAs(member);

    expect(await setOwnerAction({ userId: MEMBER_A.user.id, isOwner: true })).toEqual({
      ok: false,
      error: "Only the company's owners can do this.",
    });
    expect(db.callsFor("set_company_owner")).toHaveLength(0);
  });

  it("promotes through the RPC, for a co-owner too", async () => {
    await signInAs(CO_OWNER);
    db.queueRpc("set_company_owner", { data: { ok: true }, error: null });

    expect(await setOwnerAction({ userId: MEMBER_A.user.id, isOwner: true })).toEqual({ ok: true });
    expect(rpcArgs("set_company_owner")).toEqual([{ p_user_id: MEMBER_A.user.id, p_is_owner: true }]);
    expect(revalidatePath).toHaveBeenCalledWith("/company", "layout");
  });

  it("needs a role to demote an owner, and passes it", async () => {
    expect(await setOwnerAction({ userId: CO_OWNER.user.id, isOwner: false } as never)).toMatchObject({ ok: false });
    expect(db.callsFor("set_company_owner")).toHaveLength(0);

    db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
    db.queueRpc("set_company_owner", { data: { ok: true }, error: null });
    expect(await setOwnerAction({ userId: CO_OWNER.user.id, isOwner: false, roleId: ROLES_A.admin.id })).toEqual({
      ok: true,
    });
    expect(rpcArgs("set_company_owner")).toEqual([
      { p_user_id: CO_OWNER.user.id, p_is_owner: false, p_role_id: ROLES_A.admin.id },
    ]);
  });

  it.each([
    ["primary_owner", "The primary owner can't do this. Make another owner primary first."],
    ["last_owner", "A company needs at least one owner."],
    ["not_owner", "That person isn't an owner. Make them an owner first."],
  ])("maps %s", async (reason, message) => {
    db.queueRpc("set_company_owner", { data: { ok: false, reason }, error: null });

    expect(await setOwnerAction({ userId: OWNER_A.user.id, isOwner: false, roleId: ROLES_A.admin.id })).toEqual({
      ok: false,
      error: message,
    });
  });
});

describe("makePrimaryOwnerAction (RPT-041, RP-DEC-002)", () => {
  it("is for owners only", async () => {
    await signInAs(ADMIN_A);

    expect(await makePrimaryOwnerAction({ userId: CO_OWNER.user.id, confirmName: "Acme" })).toEqual({
      ok: false,
      error: "Only the company's owners can do this.",
    });
    expect(db.callsFor("make_primary_owner")).toHaveLength(0);
  });

  it("requires typing the company name, checked on the server", async () => {
    expect(await makePrimaryOwnerAction({ userId: CO_OWNER.user.id, confirmName: "Acm" })).toEqual({
      ok: false,
      error: "Type the company name exactly to confirm.",
    });
    expect(db.callsFor("make_primary_owner")).toHaveLength(0);
  });

  it("hands over the primary owner through the RPC and revalidates /company", async () => {
    db.queueRpc("make_primary_owner", { data: { ok: true }, error: null });

    expect(
      await makePrimaryOwnerAction({ userId: CO_OWNER.user.id, confirmName: ` ${COMPANY_A.info.name!.toUpperCase()} ` }),
    ).toEqual({ ok: true });
    expect(rpcArgs("make_primary_owner")).toEqual([{ p_user_id: CO_OWNER.user.id }]);
    expect(revalidatePath).toHaveBeenCalledWith("/company", "layout");
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: PostHogEvent.TeamPrimaryOwnerChanged }),
    );
  });

  it("maps a target that isn't an owner", async () => {
    db.queueRpc("make_primary_owner", { data: { ok: false, reason: "not_owner" }, error: null });

    expect(await makePrimaryOwnerAction({ userId: MEMBER_A.user.id, confirmName: "Acme" })).toEqual({
      ok: false,
      error: "That person isn't an owner. Make them an owner first.",
    });
  });
});

describe("updateDisplayNameAction", () => {
  it("sets the caller's own name through the RPC", async () => {
    await signInAs(MEMBER_A);
    db.queueRpc("set_my_display_name", { data: { ok: true }, error: null });

    expect(await updateDisplayNameAction({ name: "  Maxine " })).toEqual({ ok: true });
    expect(rpcArgs("set_my_display_name")).toEqual([{ p_name: "Maxine" }]);
  });

  it("rejects an empty or long name", async () => {
    expect(await updateDisplayNameAction({ name: " " })).toMatchObject({ ok: false });
    expect(await updateDisplayNameAction({ name: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(db.callsFor("set_my_display_name")).toHaveLength(0);
  });
});
