import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, MEMBER_A, OWNER_A } from "@/test/utils/team";
import { listTeam } from "./list-team";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));

let db: SupabaseMock;

const member = (m: typeof OWNER_A, joined: string) => ({
  user_id: m.user.id,
  email: m.user.email,
  display_name: m.row.display_name,
  is_owner: m.myCompany.isOwner,
  is_primary_owner: m.myCompany.isPrimaryOwner,
  role: m.myCompany.role,
  assigned_job_ids: [],
  joined_at: joined,
  last_active_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(getEntitlements).mockResolvedValue({
    entitlements: { seats: { kind: "limit", amount: 5, used: 0, held: 0, remaining: 5, overageCredits: null } },
  } as never);
});

describe("listTeam (TMT-051)", () => {
  it("returns members in the RPC's order (primary owner first), open invites, and seat usage", async () => {
    db.queueRpc("list_company_team", {
      data: {
        members: [member(OWNER_A, "2026-01-01"), member(ADMIN_A, "2026-03-01"), member(MEMBER_A, "2026-02-01")],
        invites: [
          {
            id: "f1000000-0000-4000-8000-000000000001",
            email: "priya@gmail.com",
            role: MEMBER_A.myCompany.role,
            invited_by: "Olive Owner",
            created_at: "2026-04-01",
            expires_at: "2026-04-08",
          },
        ],
      },
      error: null,
    });

    const team = await listTeam(db.client, OWNER_A.myCompany);

    expect(team.members.map((m) => m.role?.name ?? "Owner")).toEqual(["Owner", "Admin", "Member"]);
    expect(team.members[0]).toEqual({
      userId: OWNER_A.user.id,
      email: OWNER_A.user.email,
      name: "Olive Owner",
      isOwner: true,
      isPrimaryOwner: true,
      role: null,
      assignedJobIds: [],
      joinedAt: "2026-01-01",
      lastActiveAt: null,
    });
    expect(team.invites).toEqual([
      expect.objectContaining({ email: "priya@gmail.com", role: MEMBER_A.myCompany.role, invitedBy: "Olive Owner" }),
    ]);
    expect(team.seats).toEqual({ used: 4, limit: 5 });
    expect(getEntitlements).toHaveBeenCalledWith(OWNER_A.myCompany.id);
  });

  it("reads the team only through the scoped RPC, never auth.users or another company", async () => {
    db.queueRpc("list_company_team", { data: { members: [], invites: [] }, error: null });

    await listTeam(db.client, OWNER_A.myCompany);

    expect(db.calls.map((c) => c.target)).toEqual(["list_company_team"]);
    expect(db.callsFor("list_company_team")[0].chain[0].args).toEqual(["list_company_team"]);
  });

  it("throws on an RPC error", async () => {
    db.queueRpc("list_company_team", { data: null, error: { message: "boom" } });

    await expect(listTeam(db.client, OWNER_A.myCompany)).rejects.toThrow();
  });
});
