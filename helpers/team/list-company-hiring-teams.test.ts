import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1 } from "@/test/utils/team";
import { listCompanyHiringTeams } from "./list-company-hiring-teams";

vi.mock("server-only", () => ({}));

let db: SupabaseMock;

beforeEach(() => {
  db = createSupabaseMock();
});

describe("listCompanyHiringTeams (RP-REQ-011)", () => {
  it("maps the RPC's jobs and members", async () => {
    db.queueRpc("list_company_hiring_teams", {
      data: {
        jobs: [
          {
            id: JOB_A1,
            title: "Backend Engineer",
            status: "active",
            created_at: "2026-10-01T00:00:00Z",
            assigned_user_ids: [HIRING_MANAGER_A.user.id],
          },
        ],
        members: [
          {
            user_id: HIRING_MANAGER_A.user.id,
            email: HIRING_MANAGER_A.user.email,
            display_name: "Hana Manager",
            is_owner: false,
            role: HIRING_MANAGER_A.myCompany.role,
            assignable: true,
            removable: true,
          },
        ],
      },
      error: null,
    });

    expect(await listCompanyHiringTeams(db.client)).toEqual({
      jobs: [
        {
          id: JOB_A1,
          title: "Backend Engineer",
          status: "active",
          createdAt: "2026-10-01T00:00:00Z",
          assignedUserIds: [HIRING_MANAGER_A.user.id],
        },
      ],
      members: [
        {
          userId: HIRING_MANAGER_A.user.id,
          email: HIRING_MANAGER_A.user.email,
          name: "Hana Manager",
          isOwner: false,
          role: HIRING_MANAGER_A.myCompany.role,
          assignable: true,
          removable: true,
        },
      ],
    });
  });

  it("returns null when the caller doesn't hold jobs.assign", async () => {
    db.queueRpc("list_company_hiring_teams", { data: null, error: null });
    expect(await listCompanyHiringTeams(db.client)).toBeNull();
  });

  it("throws on a database error", async () => {
    db.queueRpc("list_company_hiring_teams", { data: null, error: { message: "boom" } });
    await expect(listCompanyHiringTeams(db.client)).rejects.toThrow("boom");
  });
});
