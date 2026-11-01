import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedMany } from "ai";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { CANDIDATE_EMBEDDING_MAX_READS } from "@/helpers/candidates/embedding-queue";
import { EMBEDDED_CANDIDATE_COLUMNS } from "@/helpers/candidates/embedding-text";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: { embedding: vi.fn(() => "embedding-model") } }));
vi.mock("ai", () => ({ embedMany: vi.fn() }));

const cand = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;
const ENQUEUED = "2026-10-26T10:00:00.000Z";

let db: SupabaseMock;

const message = (msg_id: number, n: number, read_ct = 1, enqueued_at = ENQUEUED) => ({
  msg_id,
  read_ct,
  enqueued_at,
  message: { candidate_id: cand(n) },
});
const row = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: cand(n),
  embedding_stale: true,
  embedding_updated_at: null,
  current_title: `Engineer ${n}`,
  current_company: "Acme",
  experience_years: 4,
  location: "bengaluru",
  skills: ["Go"],
  resume_content: null,
  ...overrides,
});

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/worker/candidate-embeddings", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

const msgIds = (fn: "delete" | "archive") =>
  db.callsFor(fn).map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);
const writes = () =>
  db.callsFor("company_candidates").filter((c) => c.chain.some((s) => s.method === "update"));
const writeOf = (n: number) =>
  writes().find((c) => c.chain.some((s) => s.method === "eq" && s.args[0] === "id" && s.args[1] === cand(n)));
const payloadOf = (n: number) => writeOf(n)?.chain.find((s) => s.method === "update")?.args[0] as Record<string, unknown>;

function queueBatch(messages: ReturnType<typeof message>[], rows: ReturnType<typeof row>[]) {
  db.queueRpc("read", { data: messages, error: null }, "pgmq_public");
  db.queue("company_candidates", { data: rows, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(embedMany).mockImplementation(
    async ({ values }) => ({ embeddings: values.map((_: string, i: number) => [i, 0.5]) }) as never,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/worker/candidate-embeddings (CPT-033, CP-REQ-042)", () => {
  it("401s without the secret or with a wrong one", async () => {
    expect((await run(null)).status).toBe(401);
    expect((await run("nope")).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("does nothing on an empty queue", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");

    expect(await (await run()).json()).toEqual({ embedded: 0, cleared: 0, skipped: 0, failed: 0 });
    expect(db.callsFor("read")[0].chain[0].args[1]).toEqual({
      queue_name: "candidate_embedding_queue",
      sleep_seconds: 60,
      n: 50,
    });
    expect(db.callsFor("company_candidates")).toHaveLength(0);
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("loads the rows with the embedded columns, never contact details", async () => {
    queueBatch([message(1, 1)], [row(1)]);
    await run();

    const select = db.callsFor("company_candidates")[0].chain.find((s) => s.method === "select")!.args[0] as string;
    const columns = select.split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "embedding_stale", "embedding_updated_at", ...EMBEDDED_CANDIDATE_COLUMNS]));
    for (const col of ["full_name", "email", "phone", "links", "tags", "notes"]) expect(columns).not.toContain(col);
  });

  it("embeds the batch in one embedMany call and writes each vector", async () => {
    queueBatch([message(1, 1), message(2, 2)], [row(1), row(2, { full_name: "Zed Secret", email: "zed@x.test" })]);

    expect(await (await run()).json()).toEqual({ embedded: 2, cleared: 0, skipped: 0, failed: 0 });
    expect(embedMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(embedMany).mock.calls[0][0];
    expect(call.values).toHaveLength(2);
    expect(call.values.join(" ")).not.toMatch(/Zed|zed@/);
    expect(call.providerOptions).toEqual({ google: { outputDimensionality: 768 } });

    expect(payloadOf(1)).toMatchObject({ embedding: [0, 0.5], embedding_stale: false });
    expect(payloadOf(2)).toMatchObject({ embedding: [1, 0.5], embedding_stale: false });
    expect(typeof payloadOf(1).embedding_updated_at).toBe("string");
    expect(msgIds("delete").sort()).toEqual([1, 2]);
  });

  it("skips messages for rows that are gone or already embedded since", async () => {
    queueBatch(
      [message(1, 1), message(2, 2), message(3, 3)],
      [
        row(2, { embedding_stale: false, embedding_updated_at: "2026-10-26T10:05:00.000Z" }),
        row(3),
      ],
    );

    expect(await (await run()).json()).toEqual({ embedded: 1, cleared: 0, skipped: 2, failed: 0 });
    expect(vi.mocked(embedMany).mock.calls[0][0].values).toHaveLength(1);
    expect(writeOf(1)).toBeUndefined();
    expect(writeOf(2)).toBeUndefined();
    expect(msgIds("delete").sort()).toEqual([1, 2, 3]);
  });

  it("embeds a row that's not stale but was embedded before the message was sent", async () => {
    queueBatch([message(1, 1)], [row(1, { embedding_stale: false, embedding_updated_at: "2026-10-26T09:00:00.000Z" })]);

    expect(await (await run()).json()).toMatchObject({ embedded: 1, skipped: 0 });
  });

  it("embeds a candidate once when it has several messages", async () => {
    queueBatch([message(1, 1), message(2, 1)], [row(1)]);

    expect(await (await run()).json()).toMatchObject({ embedded: 1 });
    expect(vi.mocked(embedMany).mock.calls[0][0].values).toHaveLength(1);
    expect(writes()).toHaveLength(1);
    expect(msgIds("delete").sort()).toEqual([1, 2]);
  });

  it("clears the embedding when there's too little to match on", async () => {
    queueBatch([message(1, 1)], [row(1, { current_title: null, skills: [], resume_content: null })]);

    expect(await (await run()).json()).toEqual({ embedded: 0, cleared: 1, skipped: 0, failed: 0 });
    expect(embedMany).not.toHaveBeenCalled();
    expect(payloadOf(1)).toMatchObject({ embedding: null, embedding_stale: false });
    expect(msgIds("delete")).toEqual([1]);
  });

  it("leaves a failed batch to retry, and gives up after the last read", async () => {
    vi.mocked(embedMany).mockRejectedValue(new Error("quota"));
    queueBatch([message(1, 1, 1), message(2, 2, CANDIDATE_EMBEDDING_MAX_READS)], [row(1), row(2)]);

    expect(await (await run()).json()).toEqual({ embedded: 0, cleared: 0, skipped: 0, failed: 1 });
    expect(writes()).toHaveLength(0);
    expect(msgIds("delete")).toEqual([]);
    expect(msgIds("archive")).toEqual([2]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain(cand(2));
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("quota");
  });

  it("leaves a row whose write failed to retry", async () => {
    queueBatch([message(1, 1), message(2, 2)], [row(1), row(2)]);
    db.queue("company_candidates", { data: null, error: { message: "boom" } });
    db.queue("company_candidates", { data: null, error: null });

    expect(await (await run()).json()).toMatchObject({ embedded: 1 });
    expect(msgIds("delete")).toHaveLength(1);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("500s when the queue or the rows can't be read", async () => {
    db.queueRpc("read", { data: null, error: { message: "down" } }, "pgmq_public");
    expect((await run()).status).toBe(500);

    db.queueRpc("read", { data: [message(1, 1)], error: null }, "pgmq_public");
    db.queue("company_candidates", { data: null, error: { message: "down" } });
    expect((await run()).status).toBe(500);
    expect(msgIds("delete")).toEqual([]);
  });

  it("consumes no allowance (CP-REQ-044)", async () => {
    queueBatch([message(1, 1)], [row(1)]);
    await run();
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });
});
