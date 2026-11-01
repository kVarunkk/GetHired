import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, OWNER_A } from "@/test/utils/team";
import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { candidateOf } from "@/test/utils/candidates";
import { loadCandidateFrame } from "./candidate-page";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/companies/get-my-company", () => ({ getMyCompany: vi.fn() }));

const candidate = candidateOf(COMPANY_A);

const application = (jobId: string, overrides: Record<string, unknown> = {}) => ({
  id: `ea000000-0000-4000-8000-0000000000${jobId.slice(-2)}`,
  created_at: "2026-10-25T00:00:00.000Z",
  stage_entered_at: "2026-10-25T00:00:00.000Z",
  job_postings: { id: jobId, title: `Job ${jobId.slice(-2)}` },
  pipeline_stages: { name: "Applied", kind: "applied" },
  ...overrides,
});

let db: SupabaseMock;

function queueCandidate(apps: ReturnType<typeof application>[] = []) {
  db.queue("company_candidates", {
    data: { ...candidate, candidate_import_batches: { file_name: "people.csv" } },
    error: null,
  });
  db.queue("applications", { data: apps, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(getMyCompany).mockResolvedValue(OWNER_A.myCompany);
});

describe("loadCandidateFrame (BI-REQ-004)", () => {
  it("loads the candidate, the source file and their open applications", async () => {
    queueCandidate([application(JOB_A1)]);

    const frame = await loadCandidateFrame(candidate.id);

    expect(frame?.candidate).toMatchObject({ id: candidate.id, full_name: candidate.full_name, sourceFile: "people.csv" });
    expect(frame?.applications).toEqual([
      expect.objectContaining({ jobId: JOB_A1, jobTitle: "Job a1", stageName: "Applied", stageKind: "applied" }),
    ]);
    expect(db.callsFor("company_candidates")[0].chain).toContainEqual({ method: "eq", args: ["id", candidate.id] });
    const apps = db.callsFor("applications")[0].chain;
    expect(apps).toContainEqual({ method: "eq", args: ["company_candidate_id", candidate.id] });
    // BI-REQ-042: a merged import shows through the application it joined.
    expect(apps).toContainEqual({ method: "is", args: ["merged_into_application_id", null] });
    expect(frame).toMatchObject({ canEdit: true, canDelete: true });
  });

  it("is null for a bad id, a logged-out viewer or a non-member", async () => {
    expect(await loadCandidateFrame("nope")).toBeNull();

    vi.mocked(getMyCompany).mockResolvedValueOnce(null);
    queueCandidate();
    expect(await loadCandidateFrame(candidate.id)).toBeNull();

    db = createSupabaseMock({ user: null });
    vi.mocked(createClient).mockResolvedValue(db.client);
    expect(await loadCandidateFrame(candidate.id)).toBeNull();
  });

  it("is null when RLS hides the candidate (another company's, or no read access, BI-PERM-002)", async () => {
    db.queue("company_candidates", { data: null, error: null });

    expect(await loadCandidateFrame(candidate.id)).toBeNull();
    expect(db.callsFor("applications")).toHaveLength(0);
  });

  it("throws on a database error", async () => {
    db.queue("company_candidates", { data: null, error: { message: "boom" } });

    await expect(loadCandidateFrame(candidate.id)).rejects.toThrow("boom");
  });

  it("lets a scoped member edit only a candidate in one of their jobs, never delete", async () => {
    const member = { ...MEMBER_A.myCompany, assignedJobIds: new Set([JOB_A1]) };
    vi.mocked(getMyCompany).mockResolvedValue(member);

    queueCandidate([application(JOB_A1)]);
    expect(await loadCandidateFrame(candidate.id)).toMatchObject({ canEdit: true, canDelete: false });

    queueCandidate([application(JOB_A2)]);
    expect(await loadCandidateFrame(candidate.id)).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("is read-only without applicants.import", async () => {
    vi.mocked(getMyCompany).mockResolvedValue(HIRING_MANAGER_A.myCompany);
    queueCandidate([application(JOB_A1)]);

    expect(await loadCandidateFrame(candidate.id)).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("offers the jobs the member can add them to, without the ones they're in", async () => {
    vi.mocked(getMyCompany).mockResolvedValue(ADMIN_A.myCompany);
    queueCandidate([application(JOB_A1)]);
    db.queue("job_postings", {
      data: [
        { id: JOB_A1, title: "Job a1" },
        { id: JOB_A2, title: "Job a2" },
      ],
      error: null,
    });

    const frame = await loadCandidateFrame(candidate.id);

    expect(frame?.jobs).toEqual([{ id: JOB_A2, title: "Job a2" }]);
  });
});
