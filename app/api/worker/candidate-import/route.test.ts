import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement, releaseHold } from "@/helpers/billing/entitlements";
import { extractResumeText, UnreadableFileError } from "@/helpers/resume/extract-text";
import { parseCandidateResume, RetryableParseError } from "@/helpers/candidates/parse-candidate-resume";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn(), releaseHold: vi.fn() }));
vi.mock("@/helpers/resume/extract-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume/extract-text")>()),
  extractResumeText: vi.fn(),
}));
vi.mock("@/helpers/candidates/parse-candidate-resume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/candidates/parse-candidate-resume")>()),
  parseCandidateResume: vi.fn(),
}));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const ROW = "f1000000-0000-4000-8000-000000000001";
const EXISTING = "cc000000-0000-4000-8000-000000000001";
const REF = { type: "candidate_import_row", id: ROW };

let db: SupabaseMock;
const download = vi.fn();

const run = () =>
  GET(buildRequest("/api/worker/candidate-import", { headers: { "X-Internal-Secret": "test-secret" } }));
const archived = () => db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);
const rowUpdates = () =>
  db
    .callsFor("candidate_import_rows")
    .map((c) => c.chain.find((m) => m.method === "update")?.args[0] as Record<string, unknown> | undefined)
    .filter(Boolean) as Record<string, unknown>[];
const lastUpdate = () => rowUpdates().at(-1)!;

function queueMessage({ status = "queued", read_ct = 1 } = {}) {
  db.queueRpc("read", { data: [{ msg_id: 7, read_ct, message: { row_id: ROW } }], error: null }, "pgmq_public");
  db.queue("candidate_import_rows", {
    data: { id: ROW, batch_id: BATCH, company_id: COMPANY_A.id, file_path: `${COMPANY_A.id}/${BATCH}/${ROW}.pdf`, status },
    error: null,
  });
}

const PARSED = {
  ok: true as const,
  fields: { full_name: "Ada", email: "ada@mail.test", location: "Bangalore" },
  resume: { sections: [] },
  warnings: [{ field: "phone", message: "Use digits, spaces and + - ( ) only.", value: "call me" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...db.client,
    storage: { from: () => ({ download }) },
  } as never);
  vi.mocked(extractResumeText).mockResolvedValue({ type: "pdf", lines: ["Ada"] });
  vi.mocked(parseCandidateResume).mockResolvedValue(PARSED);
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) => names.map((n) => n.toLowerCase()));
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
  vi.mocked(releaseHold).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/worker/candidate-import (BIT-045)", () => {
  it("401s without the secret", async () => {
    expect((await GET(buildRequest("/api/worker/candidate-import"))).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("reads 5 at a time from the import queue with a 120 s visibility timeout", async () => {
    db.queueRpc("read", { data: [], error: null }, "pgmq_public");
    expect(await (await run()).json()).toEqual({ parsed: 0, failed: 0, retried: 0, skipped: 0 });
    expect(db.callsFor("read")[0].chain[0].args[1]).toEqual({
      queue_name: "candidate_import_queue",
      sleep_seconds: 120,
      n: 5,
    });
  });

  it("parses a file, flags a duplicate, consumes the hold and settles the batch", async () => {
    queueMessage();
    db.queue("company_candidates", { data: { id: EXISTING }, error: null });
    db.queue("candidate_import_rows", { data: null, error: null }); // status -> parsing
    db.queue("candidate_import_rows", { data: null, error: null, count: 1 }); // the same email in the batch

    expect(await (await run()).json()).toMatchObject({ parsed: 1, failed: 0 });

    expect(download).toHaveBeenCalledWith(`${COMPANY_A.id}/${BATCH}/${ROW}.pdf`);
    expect(lastUpdate()).toMatchObject({
      status: "parsed",
      error_code: null,
      extracted: { fields: { full_name: "Ada", email: "ada@mail.test", location: "bangalore" }, resume: { sections: [] } },
      duplicate_of: EXISTING,
      warnings: [
        PARSED.warnings[0],
        { field: "email", message: "Another file in this import has this email.", value: "ada@mail.test" },
      ],
    });
    // Duplicates are looked up in the row's company only.
    expect(db.callsFor("company_candidates")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(consumeEntitlement).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", 1, REF, null);
    expect(releaseHold).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
    expect(db.callsFor("resume_batch_settle")[0].chain[0].args[1]).toEqual({ p_batch_id: BATCH });
  });

  it.each([
    ["no_text", () => vi.mocked(parseCandidateResume).mockResolvedValue({ ok: false, reason: "no_text" })],
    ["parse_failed", () => vi.mocked(parseCandidateResume).mockResolvedValue({ ok: false, reason: "parse_failed" })],
    ["unreadable", () => vi.mocked(extractResumeText).mockRejectedValue(new UnreadableFileError())],
  ])("fails a file as %s and releases its hold", async (code, arrange) => {
    arrange();
    queueMessage();

    expect(await (await run()).json()).toMatchObject({ parsed: 0, failed: 1 });
    expect(lastUpdate()).toMatchObject({ status: "failed", error_code: code });
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", REF);
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("leaves a provider error in the queue for a retry", async () => {
    vi.mocked(parseCandidateResume).mockRejectedValue(new RetryableParseError(new Error("503")));
    queueMessage({ read_ct: 2 });

    expect(await (await run()).json()).toMatchObject({ retried: 1, failed: 0 });
    expect(lastUpdate()).toMatchObject({ status: "queued" });
    expect(archived()).toEqual([]);
    expect(releaseHold).not.toHaveBeenCalled();
  });

  it("fails and releases after the third try, and reports it", async () => {
    vi.mocked(parseCandidateResume).mockRejectedValue(new RetryableParseError(new Error("503")));
    queueMessage({ read_ct: 3 });

    expect(await (await run()).json()).toMatchObject({ failed: 1 });
    expect(lastUpdate()).toMatchObject({ status: "failed", error_code: "parse_failed" });
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", REF);
    expect(archived()).toEqual([7]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("Gave up on 1 resume"));
  });

  it("retries a Storage download error the same way", async () => {
    download.mockResolvedValue({ data: null, error: { message: "timeout" } });
    queueMessage();
    expect(await (await run()).json()).toMatchObject({ retried: 1 });
    expect(parseCandidateResume).not.toHaveBeenCalled();
  });

  it("never parses a row twice: a redelivered message for a parsed row is skipped", async () => {
    queueMessage({ status: "parsed" });
    expect(await (await run()).json()).toMatchObject({ skipped: 1 });
    expect(download).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("skips a row removed meanwhile and releases its hold", async () => {
    queueMessage({ status: "removed" });
    expect(await (await run()).json()).toMatchObject({ skipped: 1 });
    expect(download).not.toHaveBeenCalled();
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", REF);
  });
});
