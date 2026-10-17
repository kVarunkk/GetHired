import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, OWNER_A, ROLES_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { PostHogEvent } from "@/utils/types";
import { createRoleAction } from "./create-role";
import { deleteRoleAction } from "./delete-role";
import { setDefaultRoleAction } from "./set-default-role";
import { updateRoleAction } from "./update-role";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const INTERVIEWER = {
  name: "Interviewer",
  description: "Reads applicants and writes notes",
  color: "sky" as const,
  grants: [
    { key: "applicants.view" as const, scope: "assigned" as const },
    { key: "notes.write" as const, scope: "assigned" as const },
  ],
  limits: { outreach: 0 },
};

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("createRoleAction (RPT-032, RP-TEST-006)", () => {
  it("needs roles.manage, before the RPC", async () => {
    await signInAs(MEMBER_A);

    expect(await createRoleAction(INTERVIEWER)).toEqual({ ok: false, error: "Your role can't manage roles." });
    expect(db.callsFor("create_company_role")).toHaveLength(0);
  });

  it("rejects unknown keys and scopes, and any company, user or extra field", async () => {
    for (const input of [
      { ...INTERVIEWER, grants: [{ key: "billing.manage", scope: "all" }] },
      { ...INTERVIEWER, grants: [{ key: "notes.view", scope: "everything" }] },
      { ...INTERVIEWER, limits: { seats: 3 } },
      { ...INTERVIEWER, limits: { outreach: -1 } },
      { ...INTERVIEWER, name: "" },
      { ...INTERVIEWER, name: "x".repeat(41) },
      { ...INTERVIEWER, color: "red" },
      { ...INTERVIEWER, companyId: COMPANY_A.id },
      { ...INTERVIEWER, userId: OWNER_A.user.id },
    ]) {
      expect(await createRoleAction(input as never)).toMatchObject({ ok: false });
    }
    expect(db.callsFor("create_company_role")).toHaveLength(0);
  });

  it("calls the RPC with the fields, grants and limits, and nothing about the company", async () => {
    db.queueRpc("create_company_role", { data: { ok: true, id: "r-new" }, error: null });

    expect(await createRoleAction({ ...INTERVIEWER, templateKey: "interviewer" })).toEqual({ ok: true, id: "r-new" });
    expect(rpcArgs("create_company_role")).toEqual([
      {
        p_name: "Interviewer",
        p_description: "Reads applicants and writes notes",
        p_color: "sky",
        p_grants: INTERVIEWER.grants,
        p_limits: { outreach: 0 },
        p_template_key: "interviewer",
        p_actor_kind: "user",
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/roles");
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/team");
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: PostHogEvent.CompanyRoleCreated }));
  });

  it("lets a custom role with roles.manage create one", async () => {
    await signInAs(memberWith(["roles.manage", "applicants.view", "notes.write"]));
    db.queueRpc("create_company_role", { data: { ok: true, id: "r-new" }, error: null });

    expect(await createRoleAction(INTERVIEWER)).toEqual({ ok: true, id: "r-new" });
  });

  it.each([
    ["above_ceiling", "That includes permissions or limits your own role doesn't have."],
    ["name_taken", "Another role already has that name."],
    ["invalid_grant", "One of those permissions isn't valid."],
    ["invalid_limit", "Limits must be whole numbers, 0 or more."],
    ["forbidden", "Your role doesn't allow this."],
    ["new_reason", "Something went wrong. Please try again."],
  ])("maps %s", async (reason, error) => {
    db.queueRpc("create_company_role", { data: { ok: false, reason }, error: null });

    expect(await createRoleAction(INTERVIEWER)).toEqual({ ok: false, error });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateRoleAction", () => {
  it("sends only the fields that change", async () => {
    db.queueRpc("update_company_role", { data: { ok: true, id: ROLES_A.member.id }, error: null });

    expect(await updateRoleAction({ roleId: ROLES_A.member.id, name: "Recruiter" })).toEqual({ ok: true });
    expect(rpcArgs("update_company_role")).toEqual([
      { p_role_id: ROLES_A.member.id, p_name: "Recruiter", p_actor_kind: "user" },
    ]);
  });

  it("sends grants and limits when given", async () => {
    db.queueRpc("update_company_role", { data: { ok: true }, error: null });

    await updateRoleAction({ roleId: ROLES_A.member.id, grants: INTERVIEWER.grants, limits: {} });
    expect(rpcArgs("update_company_role")[0]).toMatchObject({ p_grants: INTERVIEWER.grants, p_limits: {} });
  });

  it("maps own_role (rule 5)", async () => {
    await signInAs(ADMIN_A);
    db.queueRpc("update_company_role", { data: { ok: false, reason: "own_role" }, error: null });

    expect(await updateRoleAction({ roleId: ROLES_A.admin.id, grants: [] })).toEqual({
      ok: false,
      error: "You can't change your own role or what it allows. Ask someone else on your team.",
    });
  });

  it("validates the role id", async () => {
    expect(await updateRoleAction({ roleId: "nope", name: "X" })).toMatchObject({ ok: false });
    expect(db.callsFor("update_company_role")).toHaveLength(0);
  });
});

describe("deleteRoleAction (RP-REQ-008)", () => {
  it("passes the replacement and reports how many moved", async () => {
    db.queueRpc("delete_company_role", { data: { ok: true, moved: 3 }, error: null });

    expect(
      await deleteRoleAction({ roleId: ROLES_A.hiringManager.id, replacementRoleId: ROLES_A.member.id }),
    ).toEqual({ ok: true, moved: 3 });
    expect(rpcArgs("delete_company_role")).toEqual([
      { p_role_id: ROLES_A.hiringManager.id, p_replacement_role_id: ROLES_A.member.id, p_actor_kind: "user" },
    ]);
  });

  it.each([
    ["has_members", "Move this role's members and open invites to another role first."],
    ["is_default", "This is the role new invites get. Make another role the default first."],
  ])("maps %s", async (reason, error) => {
    db.queueRpc("delete_company_role", { data: { ok: false, reason }, error: null });

    expect(await deleteRoleAction({ roleId: ROLES_A.member.id })).toEqual({ ok: false, error });
  });

  it("needs roles.manage", async () => {
    await signInAs(MEMBER_A);
    expect(await deleteRoleAction({ roleId: ROLES_A.member.id })).toMatchObject({ ok: false });
    expect(db.callsFor("delete_company_role")).toHaveLength(0);
  });
});

describe("setDefaultRoleAction", () => {
  it("sets the default role through the RPC", async () => {
    db.queueRpc("set_default_company_role", { data: { ok: true }, error: null });

    expect(await setDefaultRoleAction({ roleId: ROLES_A.member.id })).toEqual({ ok: true });
    expect(rpcArgs("set_default_company_role")).toEqual([{ p_role_id: ROLES_A.member.id, p_actor_kind: "user" }]);
  });
});
