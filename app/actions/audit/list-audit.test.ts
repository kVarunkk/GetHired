import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { AUDIT_PAGE_SIZE } from "@/helpers/companies/audit";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { listAuditAction } from "./list-audit";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const row = (id: number) => ({
  id,
  actor_user_id: OWNER_A.user.id,
  actor_name: "Olive Owner",
  actor_kind: "user",
  action: "role.created",
  target_type: "role",
  target_id: "r1",
  target_label: "Recruiter",
  before: null,
  after: null,
  created_at: "2026-10-17T10:00:00.000Z",
});

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("listAuditAction (RPT-072)", () => {
  it("needs audit.view, before the RPC", async () => {
    await signInAs(MEMBER_A);

    expect(await listAuditAction({ before: 100 })).toEqual({
      ok: false,
      error: forbiddenMessage("audit.view"),
    });
    expect(db.callsFor("list_company_audit")).toHaveLength(0);
  });

  it("rejects malformed filters and extra fields", async () => {
    for (const input of [
      { before: 0 },
      { before: 100, actor: "not-a-uuid" },
      { before: 100, action: "billing" },
      { before: 100, since: "yesterday" },
      { before: 100, companyId: OWNER_A.company.id },
    ]) {
      db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
      expect(await listAuditAction(input as never)).toEqual({ ok: false, error: "Couldn't load more entries." });
    }
    expect(db.callsFor("list_company_audit")).toHaveLength(0);
  });

  it("passes the cursor and filters, with inclusive day bounds", async () => {
    await signInAs(ADMIN_A);
    db.queueRpc("list_company_audit", { data: [row(99), row(98)], error: null });

    const result = await listAuditAction({
      before: 100,
      actor: OWNER_A.user.id,
      action: "role",
      since: "2026-10-01",
      until: "2026-10-31",
    });

    expect(result).toMatchObject({ ok: true, nextBefore: null });
    expect(result.ok && result.entries.map((e) => e.id)).toEqual([99, 98]);
    expect(rpcArgs("list_company_audit")).toEqual([
      {
        p_limit: AUDIT_PAGE_SIZE,
        p_before: 100,
        p_actor: OWNER_A.user.id,
        p_action: "role",
        p_since: "2026-10-01T00:00:00.000Z",
        p_until: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns the next cursor when the page is full", async () => {
    db.queueRpc("list_company_audit", {
      data: Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) => row(200 - i)),
      error: null,
    });

    const result = await listAuditAction({ before: 201 });

    expect(result).toMatchObject({ ok: true, nextBefore: 200 - AUDIT_PAGE_SIZE + 1 });
  });
});
