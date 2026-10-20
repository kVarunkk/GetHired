import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { listMemberUsage } from "./member-usage";

let db: SupabaseMock;

beforeEach(() => {
  db = createSupabaseMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listMemberUsage (RP-REQ-044)", () => {
  it("maps the RPC rows, keeping only allowance keys", async () => {
    db.queueRpc("member_usage", {
      data: [
        { user_id: "u1", name: "Olive", is_owner: true, role: null, usage: { outreach: 3 }, limits: {} },
        {
          user_id: "u2",
          name: null,
          is_owner: false,
          role: { id: "r1", name: "Recruiter" },
          usage: { outreach: 48, seats: 1 },
          limits: { outreach: 50 },
        },
      ],
      error: null,
    });

    expect(await listMemberUsage(db.client)).toEqual([
      { userId: "u1", name: "Olive", isOwner: true, roleName: null, usage: { outreach: 3 }, limits: {} },
      { userId: "u2", name: "Unnamed member", isOwner: false, roleName: "Recruiter", usage: { outreach: 48 }, limits: { outreach: 50 } },
    ]);
    expect(db.callsFor("member_usage")).toHaveLength(1);
  });

  it("returns null without billing.view (the RPC returns null)", async () => {
    db.queueRpc("member_usage", { data: null, error: null });
    expect(await listMemberUsage(db.client)).toBeNull();
  });

  it("returns null on an error", async () => {
    db.queueRpc("member_usage", { data: null, error: { message: "boom" } });
    expect(await listMemberUsage(db.client)).toBeNull();
  });
});
