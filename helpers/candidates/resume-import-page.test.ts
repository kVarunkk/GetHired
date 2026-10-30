import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1 } from "@/test/utils/team";
import { loadImportPage, type ImportPage } from "./import-page";
import { loadResumeImportPage } from "./resume-import-page";

vi.mock("./import-page", () => ({ loadImportPage: vi.fn() }));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const ROW = "f1000000-0000-4000-8000-000000000001";
const PAGE: ImportPage = {
  jobs: [],
  stages: [],
  lists: null,
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: null,
  notFound: false,
};
const FIXED = { id: JOB_A1, title: "Backend Engineer", interview: null };

function db() {
  const mock = createSupabaseMock();
  mock.queue("candidate_import_batches", {
    data: {
      id: BATCH,
      status: "ready",
      job_post_id: null,
      talent_list_id: null,
      stage_id: null,
      auto_invite: false,
      expires_at: "2026-11-01T00:00:00Z",
    },
    error: null,
  });
  mock.queue("candidate_import_rows", {
    data: [
      {
        id: ROW,
        file_name: "a.pdf",
        status: "parsed",
        error_code: null,
        extracted: { fields: { full_name: "Ada" } },
        edited: null,
        warnings: [],
        duplicate_of: null,
        duplicate_action: null,
      },
    ],
    error: null,
  });
  return mock;
}

beforeEach(() => vi.mocked(loadImportPage).mockReset());

describe("loadResumeImportPage (CP-REQ-010/011)", () => {
  it("picks up the Candidates page's own open batch, with no job", async () => {
    vi.mocked(loadImportPage).mockResolvedValue(PAGE);
    const mock = db();

    const page = await loadResumeImportPage(mock.client, ADMIN_A.myCompany, { userId: ADMIN_A.user.id });

    expect(page?.open?.batch).toMatchObject({ id: BATCH, jobPostId: null, talentListId: null });
    expect(page?.open?.rows.map((r) => r.id)).toEqual([ROW]);
    const chain = mock.callsFor("candidate_import_batches")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["opened_from", "candidates"] });
    expect(chain).toContainEqual({ method: "eq", args: ["created_by", ADMIN_A.user.id] });
    expect(chain).not.toContainEqual(expect.objectContaining({ args: ["job_post_id", expect.anything()] }));
  });

  it("picks up the job page's batch for that job", async () => {
    vi.mocked(loadImportPage).mockResolvedValue({ ...PAGE, fixedJob: FIXED });
    const mock = db();

    await loadResumeImportPage(mock.client, ADMIN_A.myCompany, { userId: ADMIN_A.user.id, jobId: JOB_A1 });

    expect(vi.mocked(loadImportPage).mock.calls[0][2]).toEqual({ jobId: JOB_A1 });
    const chain = mock.callsFor("candidate_import_batches")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["opened_from", "job"] });
    expect(chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_A1] });
  });

  it("reads no batch for a job the member can't import into, and is null when they can't import", async () => {
    vi.mocked(loadImportPage).mockResolvedValue({ ...PAGE, notFound: true });
    const mock = db();
    expect(await loadResumeImportPage(mock.client, ADMIN_A.myCompany, { userId: ADMIN_A.user.id, jobId: JOB_A1 })).toMatchObject({
      notFound: true,
      open: null,
    });
    expect(mock.calls).toHaveLength(0);

    vi.mocked(loadImportPage).mockResolvedValue(null);
    expect(await loadResumeImportPage(mock.client, ADMIN_A.myCompany, { userId: ADMIN_A.user.id })).toBeNull();
  });
});
