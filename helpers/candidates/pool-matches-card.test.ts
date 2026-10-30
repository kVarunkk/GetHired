import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, JOB_A2, memberOf, memberWith, OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { listPoolMatches } from "./pool-matches";
import { loadPoolMatchesCard, poolNoticeCount } from "./pool-matches-card";

vi.mock("./pool-matches", () => ({ listPoolMatches: vi.fn() }));

const MATCH = {
  id: "cc000000-0000-4000-8000-000000000001",
  name: "Meera",
  title: null,
  location: null,
  experienceYears: null,
  skills: [],
  hasEmail: true,
  hasResume: false,
  similarity: 0.7,
  score: 57,
};
const STAGES = [{ id: "5a000000-0000-4000-8000-000000000001", name: "Applied" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPoolMatches).mockResolvedValue({ ok: true, status: "ok", poolSize: 3, matches: [MATCH] });
});

describe("loadPoolMatchesCard (CPT-053, CP-REQ-060)", () => {
  it("loads the matches and the stages to add them to", async () => {
    const db = createSupabaseMock();
    db.queue("pipeline_stages", { data: STAGES, error: null });

    expect(await loadPoolMatchesCard(db.client, OWNER_A.myCompany, JOB_A1)).toEqual({
      status: "ok",
      matches: [MATCH],
      stages: STAGES,
    });
    expect(listPoolMatches).toHaveBeenCalledWith(db.client, JOB_A1);
    const { chain } = db.callsFor("pipeline_stages")[0];
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["archived", false] });
  });

  it("is hidden without talent.view or jobs.view for the job", async () => {
    const db = createSupabaseMock();
    const noTalent = memberWith(["jobs.view", "applicants.import"]);
    expect(await loadPoolMatchesCard(db.client, noTalent.myCompany, JOB_A1)).toBeNull();
    const scoped = memberWith(["talent.view", { key: "jobs.view", scope: "assigned" }], { assignedJobIds: [JOB_A2] });
    expect(await loadPoolMatchesCard(db.client, scoped.myCompany, JOB_A1)).toBeNull();
    expect(listPoolMatches).not.toHaveBeenCalled();
  });

  it("offers no adding without applicants.import for the job", async () => {
    const db = createSupabaseMock();
    const viewer = memberWith(["talent.view", "jobs.view"]);
    expect(await loadPoolMatchesCard(db.client, viewer.myCompany, JOB_A1)).toMatchObject({ stages: null });
    expect(db.callsFor("pipeline_stages")).toHaveLength(0);
  });

  it("is hidden with no embedded candidates, or when matching fails", async () => {
    const db = createSupabaseMock();
    vi.mocked(listPoolMatches).mockResolvedValueOnce({ ok: true, status: "no_pool", poolSize: 0, matches: [] });
    expect(await loadPoolMatchesCard(db.client, OWNER_A.myCompany, JOB_A1)).toBeNull();
    vi.mocked(listPoolMatches).mockResolvedValueOnce({ ok: false, error: "nope" });
    expect(await loadPoolMatchesCard(db.client, OWNER_A.myCompany, JOB_A1)).toBeNull();
  });

  it("shows the pending state while the job isn't embedded", async () => {
    const db = createSupabaseMock();
    vi.mocked(listPoolMatches).mockResolvedValueOnce({ ok: true, status: "no_job_embedding", poolSize: 4, matches: [] });
    expect(await loadPoolMatchesCard(db.client, OWNER_A.myCompany, JOB_A1)).toMatchObject({
      status: "no_job_embedding",
    });
  });

  it("is shown to the Member template", async () => {
    const db = createSupabaseMock();
    expect(await loadPoolMatchesCard(db.client, memberOf(COMPANY_A, "member").myCompany, JOB_A1)).not.toBeNull();
  });
});

describe("poolNoticeCount (CPT-054, CP-REQ-061)", () => {
  const card = { status: "ok" as const, matches: [MATCH, { ...MATCH, id: "x" }], stages: null };
  it("counts the matches right after the job was created", () => {
    expect(poolNoticeCount(card, true)).toBe(2);
  });
  it("is hidden without the flag, without matches, or while the job isn't embedded", () => {
    expect(poolNoticeCount(card, false)).toBeNull();
    expect(poolNoticeCount({ ...card, matches: [] }, true)).toBeNull();
    expect(poolNoticeCount({ ...card, status: "no_job_embedding" }, true)).toBeNull();
    expect(poolNoticeCount(null, true)).toBeNull();
  });
});
