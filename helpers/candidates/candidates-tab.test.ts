import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, memberWith, OWNER_A } from "@/test/utils/team";
import { loadCandidatesTab } from "./candidates-tab";

const LIST = "70000000-0000-4000-8000-000000000001";

function dbWithEmptyTab() {
  const db = createSupabaseMock();
  // The jobs to match to load first: the filter is checked against them.
  db.queue("job_postings", { data: [{ id: JOB_A1, title: "Backend Engineer" }], error: null });
  db.queue("company_candidates", { data: [], error: null, count: 0 });
  db.queue("company_candidates", { data: [], error: null });
  db.queue("candidate_import_batches", { data: [], error: null });
  db.queue("job_postings", { data: [{ id: JOB_A1, title: "Backend Engineer" }], error: null });
  return db;
}

describe("loadCandidatesTab (BI-REQ-003)", () => {
  it("loads the page, its filter options and the jobs the member can import into", async () => {
    const db = dbWithEmptyTab();

    const tab = await loadCandidatesTab(db.client, ADMIN_A.myCompany, { q: "meera", page: "2" });

    expect(tab.filters).toMatchObject({ q: "meera", page: 2 });
    expect(tab.list).toMatchObject({ items: [], total: 0, page: 2 });
    expect(tab.jobs).toEqual([{ id: JOB_A1, title: "Backend Engineer" }]);
    const jobs = db.callsFor("job_postings")[1].chain;
    expect(jobs).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(jobs).toContainEqual({ method: "eq", args: ["status", "active"] });
    // Admin imports into every job: no job filter.
    expect(jobs.some((m) => m.method === "in")).toBe(false);
    expect(tab).toMatchObject({ canCreate: true, canDelete: true, canManageLists: true });
  });

  it("limits the jobs to a scoped member's assigned ones, and keeps delete from them", async () => {
    const db = dbWithEmptyTab();
    const member = { ...MEMBER_A.myCompany, assignedJobIds: new Set([JOB_A1]) };

    const tab = await loadCandidatesTab(db.client, member, {});

    expect(db.callsFor("job_postings")[1].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
    expect(tab.canCreate).toBe(true);
    expect(tab.canDelete).toBe(false);
  });

  it("offers no jobs, adding or deleting without applicants.import", async () => {
    const db = dbWithEmptyTab();

    const tab = await loadCandidatesTab(db.client, HIRING_MANAGER_A.myCompany, {});

    // Only the jobs to match to, if any.
    expect(db.callsFor("job_postings").length).toBeLessThanOrEqual(1);
    expect(tab).toMatchObject({ jobs: [], canCreate: false, canDelete: false });
  });

  it("hides list actions without talent_lists.manage", async () => {
    const db = dbWithEmptyTab();

    const tab = await loadCandidatesTab(db.client, memberWith(["talent.view"]).myCompany, {});

    expect(tab.canManageLists).toBe(false);
  });

  it("reads a talent list's company candidates only (BI-REQ-006)", async () => {
    const db = dbWithEmptyTab();

    const tab = await loadCandidatesTab(db.client, OWNER_A.myCompany, {}, { listId: LIST });

    expect(tab.filters.listId).toBe(LIST);
    expect(db.callsFor("company_candidates")[0].chain).toContainEqual({
      method: "eq",
      args: ["talent_list_members.list_id", LIST],
    });
  });

  it("still shows the table when the extras fail", async () => {
    const db = createSupabaseMock();
    db.queue("job_postings", { data: null, error: { message: "boom" } });
    db.queue("company_candidates", { data: [], error: null, count: 0 });
    db.queue("company_candidates", { data: null, error: { message: "boom" } });
    db.queue("candidate_import_batches", { data: null, error: { message: "boom" } });
    db.queue("job_postings", { data: null, error: { message: "boom" } });

    const tab = await loadCandidatesTab(db.client, OWNER_A.myCompany, {});

    expect(tab.options).toEqual({ tags: [], batches: [] });
    expect(tab.jobs).toEqual([]);
    expect(tab.matchJobs).toEqual([]);
  });
});

describe("loadCandidatesTab: match to job (CPT-056, CP-REQ-071)", () => {
  it("offers the jobs the member can view, and keeps a filter for one of them", async () => {
    const db = dbWithEmptyTab();
    db.queueRpc("match_company_candidates", { data: { ok: true, job_embedded: true, pool_size: 0, matches: [] }, error: null });

    const tab = await loadCandidatesTab(db.client, OWNER_A.myCompany, { matchJob: JOB_A1 });

    expect(tab.matchJobs).toEqual([{ id: JOB_A1, title: "Backend Engineer" }]);
    expect(tab.filters.matchJob).toBe(JOB_A1);
    const jobs = db.callsFor("job_postings")[0].chain;
    expect(jobs).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(jobs).toContainEqual({ method: "eq", args: ["status", "active"] });
    expect(db.callsFor("match_company_candidates")).toHaveLength(1);
  });

  it("ignores a job the member can't view", async () => {
    const db = dbWithEmptyTab();
    const scoped = memberWith(["talent.view", { key: "jobs.view", scope: "assigned" }], { assignedJobIds: [JOB_A1] });

    const tab = await loadCandidatesTab(db.client, scoped.myCompany, { matchJob: JOB_A2 });

    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
    expect(tab.filters.matchJob).toBeNull();
    expect(db.callsFor("match_company_candidates")).toHaveLength(0);
  });

  it("isn't offered on a talent list, or without talent.view", async () => {
    const db = dbWithEmptyTab();
    const tab = await loadCandidatesTab(db.client, OWNER_A.myCompany, { matchJob: JOB_A1 }, { listId: LIST });
    expect(tab.matchJobs).toBeNull();
    expect(tab.filters.matchJob).toBeNull();

    const db2 = dbWithEmptyTab();
    const noTalent = await loadCandidatesTab(db2.client, memberWith(["jobs.view"]).myCompany, {});
    expect(noTalent.matchJobs).toBeNull();
  });
});
