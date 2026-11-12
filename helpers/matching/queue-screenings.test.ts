import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { JOB_POST } from "@/test/utils/matching";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { queueJobScreenings, requeueScreenings } from "./queue-screenings";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn() }));
vi.mock("server-only", () => ({}));

const appId = (n: number) => `e1000000-0000-4000-8000-00000000000${n}`;
const USER = { id: "u1000000-0000-4000-8000-000000000001" };

let admin: SupabaseMock;
let rls: SupabaseMock;

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const argOf = (call: RecordedCall, method: string) => call.chain.find((m) => m.method === method)!.args;
const inserts = () => admin.callsFor("application_screenings").filter((c) => has(c, "upsert"));
const moves = () => admin.callsFor("application_screenings").filter((c) => has(c, "update"));
const sentIds = () =>
  admin
    .callsFor("send_batch")
    .flatMap((c) => (c.chain[0].args[1] as { messages: { application_id: string }[] }).messages.map((m) => m.application_id));

/** The insert returns the rows it added, the guarded move the rows it moved. */
function answerWrites(inserted: string[], moved: string[]) {
  admin.queue("application_screenings", { data: inserted.map((id) => ({ application_id: id })), error: null });
  admin.queue("application_screenings", { data: moved.map((id) => ({ application_id: id })), error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  rls = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
});

describe("requeueScreenings (SMT-017, SM-ISS-002)", () => {
  const apps = [
    { id: appId(1), job_post_id: JOB_POST.id },
    { id: appId(2), job_post_id: JOB_POST.id },
    { id: appId(3), job_post_id: null },
  ];

  it("inserts missing rows without touching existing ones", async () => {
    answerWrites([appId(1)], [appId(2)]);

    await requeueScreenings(admin.client, { companyId: COMPANY_A.id, applications: apps, requestedBy: USER.id });

    const [insert] = inserts();
    expect(argOf(insert, "upsert")).toEqual([
      [
        expect.objectContaining({ application_id: appId(1), job_post_id: JOB_POST.id, status: "queued", attempts: 0, requested_by: USER.id }),
        expect.objectContaining({ application_id: appId(2), status: "queued" }),
      ],
      { onConflict: "application_id", ignoreDuplicates: true },
    ]);
    expect(argOf(insert, "select")).toEqual(["application_id"]);
  });

  it("moves every state but queued back to queued, processing included, and clears the claim", async () => {
    answerWrites([appId(1)], [appId(2)]);

    await requeueScreenings(admin.client, { companyId: COMPANY_A.id, applications: apps, requestedBy: USER.id });

    const [move] = moves();
    expect(argOf(move, "update")[0]).toEqual(
      expect.objectContaining({ status: "queued", attempts: 0, error_code: null, claimed_at: null, requested_by: USER.id }),
    );
    expect(move.chain).toContainEqual({ method: "in", args: ["application_id", [appId(1), appId(2)]] });
    const from = move.chain.find((m) => m.method === "in" && m.args[0] === "status")!.args[1] as string[];
    expect([...from].sort()).toEqual(["completed", "failed", "insufficient_info", "processing", "skipped_quota", "stale"]);
  });

  it("sends a message for each row it inserted or moved, and returns the count", async () => {
    answerWrites([appId(1)], [appId(2)]);

    const count = await requeueScreenings(admin.client, {
      companyId: COMPANY_A.id,
      applications: apps,
      requestedBy: USER.id,
    });

    expect(count).toBe(2);
    expect(sentIds()).toEqual([appId(1), appId(2)]);
  });

  it("sends nothing for a row already queued (its message is pending)", async () => {
    answerWrites([], []);

    const count = await requeueScreenings(admin.client, {
      companyId: COMPANY_A.id,
      applications: apps,
      requestedBy: USER.id,
    });

    expect(count).toBe(0);
    expect(admin.callsFor("send_batch")).toHaveLength(0);
  });

  it("does nothing for applications with no job", async () => {
    const count = await requeueScreenings(admin.client, {
      companyId: COMPANY_A.id,
      applications: [{ id: appId(3), job_post_id: null }],
      requestedBy: USER.id,
    });

    expect(count).toBe(0);
    expect(admin.calls).toHaveLength(0);
  });

  it("marks the rows failed from queued only and throws when the send fails", async () => {
    answerWrites([appId(1)], [appId(2)]);
    admin.queueRpc("send_batch", { data: null, error: { message: "queue down" } }, "pgmq_public");

    await expect(
      requeueScreenings(admin.client, { companyId: COMPANY_A.id, applications: apps, requestedBy: USER.id }),
    ).rejects.toThrow(/queue/);

    const failed = moves().at(-1)!;
    expect(argOf(failed, "update")[0]).toEqual(expect.objectContaining({ status: "failed", error_code: "worker_error" }));
    expect(failed.chain).toContainEqual({ method: "in", args: ["application_id", [appId(1), appId(2)]] });
    expect(failed.chain).toContainEqual({ method: "in", args: ["status", ["queued"]] });
  });
});

describe("queueJobScreenings (SMT-017, SM-ISS-002)", () => {
  const ctx = () => ({ supabase: rls.client, company: { id: COMPANY_A.id } as MyCompany, user: USER });

  function ownsJob(applicationIds: string[], screenings: { application_id: string; status: string }[]) {
    rls.queue("job_postings", { data: { id: JOB_POST.id }, error: null });
    admin.queue("applications", { data: applicationIds.map((id) => ({ id })), error: null });
    admin.queue("application_screenings", { data: screenings, error: null });
  }

  it("inserts the missing ones and moves only the re-screenable states, in one pass", async () => {
    ownsJob([appId(1), appId(2), appId(3)], [
      { application_id: appId(2), status: "stale" },
      { application_id: appId(3), status: "completed" },
    ]);
    answerWrites([appId(1)], [appId(2)]);

    const result = await queueJobScreenings(ctx(), JOB_POST.id);

    expect(result).toEqual({ ok: true, queued: 2 });
    const [insert] = inserts();
    expect(argOf(insert, "upsert")[1]).toEqual({ onConflict: "application_id", ignoreDuplicates: true });
    const [move] = moves();
    const from = move.chain.find((m) => m.method === "in" && m.args[0] === "status")!.args[1] as string[];
    expect([...from].sort()).toEqual(["failed", "insufficient_info", "skipped_quota", "stale"]);
    expect(argOf(move, "update")[0]).toEqual(expect.objectContaining({ status: "queued", claimed_at: null }));
    expect(sentIds()).toEqual([appId(1), appId(2)]);
  });

  it("counts and sends only what the writes moved, when a worker got there first", async () => {
    // Read as stale, but a worker claimed it before the write: not moved.
    ownsJob([appId(1)], [{ application_id: appId(1), status: "stale" }]);
    answerWrites([], []);

    const result = await queueJobScreenings(ctx(), JOB_POST.id);

    expect(result).toEqual({ ok: true, queued: 0 });
    expect(admin.callsFor("send_batch")).toHaveLength(0);
  });

  it("marks the sent-to-fail rows failed from queued only", async () => {
    ownsJob([appId(1)], []);
    answerWrites([appId(1)], []);
    admin.queueRpc("send_batch", { data: null, error: { message: "queue down" } }, "pgmq_public");

    const result = await queueJobScreenings(ctx(), JOB_POST.id);

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    const failed = moves().at(-1)!;
    expect(argOf(failed, "update")[0]).toEqual(expect.objectContaining({ status: "failed", error_code: "worker_error" }));
    expect(failed.chain).toContainEqual({ method: "in", args: ["status", ["queued"]] });
  });

  it("reports queue_failed when a write errors", async () => {
    ownsJob([appId(1)], []);
    admin.queue("application_screenings", { data: null, error: { message: "db down" } });

    expect(await queueJobScreenings(ctx(), JOB_POST.id)).toEqual({ ok: false, reason: "queue_failed" });
    expect(admin.callsFor("send_batch")).toHaveLength(0);
  });
});
