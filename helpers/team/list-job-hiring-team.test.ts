import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1 } from "@/test/utils/team";
import { listJobHiringTeam } from "./list-job-hiring-team";

vi.mock("server-only", () => ({}));

let db: SupabaseMock;

beforeEach(() => {
  db = createSupabaseMock();
});

describe("listJobHiringTeam (RPT-052)", () => {
  it("maps the RPC's members for the job", async () => {
    db.queueRpc("list_job_hiring_team", {
      data: [
        {
          user_id: HIRING_MANAGER_A.user.id,
          email: HIRING_MANAGER_A.user.email,
          display_name: "Hana Manager",
          is_owner: false,
          role: HIRING_MANAGER_A.myCompany.role,
          assigned: true,
          assignable: true,
          removable: true,
        },
      ],
      error: null,
    });

    expect(await listJobHiringTeam(db.client, JOB_A1)).toEqual([
      {
        userId: HIRING_MANAGER_A.user.id,
        email: HIRING_MANAGER_A.user.email,
        name: "Hana Manager",
        isOwner: false,
        role: HIRING_MANAGER_A.myCompany.role,
        assigned: true,
        assignable: true,
        removable: true,
      },
    ]);
    expect(db.callsFor("list_job_hiring_team")[0].chain[0].args).toEqual(["list_job_hiring_team", { p_job_post_id: JOB_A1 }]);
  });

  it("returns null when the caller can't assign on the job", async () => {
    db.queueRpc("list_job_hiring_team", { data: null, error: null });
    expect(await listJobHiringTeam(db.client, JOB_A1)).toBeNull();
  });

  it("throws on a database error", async () => {
    db.queueRpc("list_job_hiring_team", { data: null, error: { message: "boom" } });
    await expect(listJobHiringTeam(db.client, JOB_A1)).rejects.toThrow("boom");
  });
});
