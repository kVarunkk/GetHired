import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1 } from "@/test/utils/team";
import { loadImportPage } from "./import-page";
import { loadNewCandidatePage } from "./new-candidate";

vi.mock("./import-page", () => ({ loadImportPage: vi.fn(async () => null) }));

describe("loadNewCandidatePage (BI-REQ-009, CP-REQ-010)", () => {
  it("is the import page's loader, with the job when there is one", async () => {
    const { client } = createSupabaseMock();
    await loadNewCandidatePage(client, ADMIN_A.myCompany, JOB_A1);
    await loadNewCandidatePage(client, ADMIN_A.myCompany);
    expect(vi.mocked(loadImportPage).mock.calls.map((c) => c[2])).toEqual([{ jobId: JOB_A1 }, { jobId: undefined }]);
  });
});
