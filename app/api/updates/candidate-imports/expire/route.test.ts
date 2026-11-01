import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { releaseHold } from "@/helpers/billing/entitlements";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ releaseHold: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const row = (n: number, company = COMPANY_A.id) => ({
  id: `f1000000-0000-4000-8000-00000000000${n}`,
  company_id: company,
  file_path: `${company}/batch/${n}.pdf`,
  candidate_import_batches: { expires_at: "2026-10-01T00:00:00Z" },
});

let db: SupabaseMock;
const remove = vi.fn();
const run = () =>
  GET(buildRequest("/api/updates/candidate-imports/expire", { headers: { "X-Internal-Secret": "test-secret" } }));

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  remove.mockResolvedValue({ data: [], error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({ ...db.client, storage: { from: () => ({ remove }) } } as never);
  vi.mocked(releaseHold).mockResolvedValue(true);
});

describe("GET /api/updates/candidate-imports/expire (BIT-048, BI-REQ-026)", () => {
  it("401s without the secret", async () => {
    expect((await GET(buildRequest("/api/updates/candidate-imports/expire"))).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("deletes the unkept files and rows of expired batches, releases each hold once and expires the batches", async () => {
    db.queue("candidate_import_rows", { data: [row(1), row(2), row(3, COMPANY_B.id)], error: null });
    db.queue("candidate_import_rows", { data: null, error: null });
    db.queue("candidate_import_batches", { data: [{ id: "b1" }], error: null });

    expect(await (await run()).json()).toEqual({ rows: 3, batches: 1, failed: 0 });

    const [load, del] = db.callsFor("candidate_import_rows");
    // Confirmed rows (candidates' resumes) are never touched.
    expect(load.chain).toContainEqual({ method: "neq", args: ["status", "confirmed"] });
    expect(load.chain).toContainEqual({ method: "lt", args: ["candidate_import_batches.expires_at", expect.any(String)] });
    expect(del.chain).toContainEqual({ method: "in", args: ["id", [row(1).id, row(2).id, row(3).id]] });
    expect(remove).toHaveBeenCalledWith([row(1).file_path, row(2).file_path, row(3, COMPANY_B.id).file_path]);
    expect(vi.mocked(releaseHold).mock.calls).toEqual([
      [COMPANY_A.id, "resume_imports", { type: "candidate_import_row", id: row(1).id }],
      [COMPANY_A.id, "resume_imports", { type: "candidate_import_row", id: row(2).id }],
      [COMPANY_B.id, "resume_imports", { type: "candidate_import_row", id: row(3).id }],
    ]);

    // Only batches that were never confirmed become expired.
    const [expire] = db.callsFor("candidate_import_batches");
    expect(expire.chain).toContainEqual({ method: "update", args: [{ status: "expired" }] });
    expect(expire.chain).toContainEqual({ method: "in", args: ["status", ["draft", "parsing", "ready"]] });
  });

  it("does nothing to Storage when nothing expired", async () => {
    db.queue("candidate_import_rows", { data: [], error: null });
    db.queue("candidate_import_batches", { data: [], error: null });
    expect(await (await run()).json()).toEqual({ rows: 0, batches: 0, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(releaseHold).not.toHaveBeenCalled();
  });

  it("reports a failure by email", async () => {
    db.queue("candidate_import_rows", { data: [row(1)], error: null });
    db.queue("candidate_import_rows", { data: null, error: { message: "boom" } });
    db.queue("candidate_import_batches", { data: [], error: null });
    expect(await (await run()).json()).toMatchObject({ failed: 1 });
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
