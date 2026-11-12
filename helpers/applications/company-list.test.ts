import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { JOB_A1, OWNER_A } from "@/test/utils/team";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { parseApplicationListParams } from "./list-params";
import { loadCompanyApplications } from "./company-list";

let supabase: SupabaseMock;

const OWNER = OWNER_A.myCompany;
const SCOPED: MyCompany = {
  ...OWNER,
  isOwner: false,
  grants: new Map([["applicants.view", "assigned"], ["jobs.view", "assigned"]]),
  assignedJobIds: new Set([JOB_A1]),
};

const row = (n: number) => ({ id: `e0000000-0000-4000-8000-00000000000${n}`, person_name: `P${n}` });
const listCalls = () => supabase.callsFor("company_application_list");
const chainOf = (i = 0) => listCalls()[i].chain;
const methods = (chain: { method: string; args: unknown[] }[], method: string) =>
  chain.filter((c) => c.method === method).map((c) => c.args);

const load = (company: MyCompany, params: Record<string, string> = {}) =>
  loadCompanyApplications({ supabase: supabase.client, company }, parseApplicationListParams(params));

beforeEach(() => {
  supabase = createSupabaseMock({ user: COMPANY_A.user });
  supabase.queue("job_postings", { data: [{ id: JOB_A1, title: "Backend" }], error: null });
});

describe("loadCompanyApplications (QF-REQ-021/022/024)", () => {
  it("reads one page of the view for the session company, newest first, with the job options", async () => {
    supabase.queue("company_application_list", { data: [row(1), row(2)], error: null, count: 2 });

    const result = await load(OWNER);

    expect(result).toEqual({
      ok: true,
      rows: [row(1), row(2)],
      total: 2,
      page: 1,
      pageSize: 25,
      jobs: [{ id: JOB_A1, title: "Backend" }],
    });
    const chain = chainOf();
    expect(methods(chain, "select")[0][1]).toEqual({ count: "exact" });
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(methods(chain, "order")).toEqual([
      ["created_at", { ascending: false, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
    expect(methods(chain, "range")).toEqual([[0, 24]]);
    expect(methods(chain, "in")).toEqual([]);

    const [jobs] = supabase.callsFor("job_postings");
    expect(jobs.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("limits a scoped member to their assigned jobs, in the list and the job options", async () => {
    supabase.queue("company_application_list", { data: [], error: null, count: 0 });

    await load(SCOPED);

    expect(methods(chainOf(), "in")).toEqual([["job_post_id", [JOB_A1]]]);
    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
  });

  it("applies every filter", async () => {
    supabase.queue("company_application_list", { data: [], error: null, count: 0 });

    await load(OWNER, {
      q: "50%_ada",
      job: JOB_A1,
      status: "rejected",
      recommendation: "yes",
      knockout: "failed",
    });

    const chain = chainOf();
    expect(chain).toContainEqual({ method: "ilike", args: ["person_name", "%50\\%\\_ada%"] });
    expect(chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_A1] });
    expect(chain).toContainEqual({ method: "eq", args: ["status", "rejected"] });
    expect(chain).toContainEqual({ method: "eq", args: ["recommendation", "yes"] });
    expect(chain).toContainEqual({ method: "eq", args: ["knockout_failed", true] });
  });

  it("reads a passed knockout as knockout_failed = false", async () => {
    supabase.queue("company_application_list", { data: [], error: null, count: 0 });
    await load(OWNER, { knockout: "passed" });
    expect(chainOf()).toContainEqual({ method: "eq", args: ["knockout_failed", false] });
  });

  it.each([
    ["fit_score", {}, ["fit_score", { ascending: false, nullsFirst: false }]],
    ["person_name", {}, ["person_name", { ascending: true, nullsFirst: false }]],
    ["status", { dir: "desc" }, ["status", { ascending: false, nullsFirst: false }]],
  ])("sorts by %s with id as the tiebreaker", async (sort, extra, expected) => {
    supabase.queue("company_application_list", { data: [], error: null, count: 0 });
    await load(OWNER, { sort, ...extra });
    expect(methods(chainOf(), "order")).toEqual([expected, ["id", { ascending: true }]]);
  });

  it("reads page 2 as rows 25–49", async () => {
    supabase.queue("company_application_list", { data: [row(3)], error: null, count: 30 });

    const result = await load(OWNER, { page: "2" });

    expect(methods(chainOf(), "range")).toEqual([[25, 49]]);
    expect(result).toMatchObject({ ok: true, page: 2, total: 30 });
  });

  it("shows the last page for a page past the end", async () => {
    supabase.queue("company_application_list", { data: [], error: null, count: 30 });
    supabase.queue("company_application_list", { data: [row(3)], error: null, count: 30 });

    const result = await load(OWNER, { page: "99" });

    expect(methods(chainOf(0), "range")).toEqual([[2450, 2474]]);
    expect(methods(chainOf(1), "range")).toEqual([[25, 49]]);
    expect(result).toMatchObject({ ok: true, page: 2, total: 30, rows: [row(3)] });
  });

  it("shows the last page when PostgREST refuses the range", async () => {
    supabase.queue("company_application_list", { data: null, error: { code: "PGRST103", message: "range" } });
    supabase.queue("company_application_list", { data: null, error: null, count: 30 });
    supabase.queue("company_application_list", { data: [row(3)], error: null, count: 30 });

    const result = await load(OWNER, { page: "99" });

    expect(methods(chainOf(1), "select")[0][1]).toEqual({ count: "exact", head: true });
    expect(methods(chainOf(2), "range")).toEqual([[25, 49]]);
    expect(result).toMatchObject({ ok: true, page: 2, rows: [row(3)] });
  });

  it("returns an error result, not a throw, when the view can't be read", async () => {
    supabase.queue("company_application_list", { data: null, error: { message: "boom" } });

    expect(await load(OWNER)).toEqual({ ok: false, error: "Couldn't load the applications." });
  });
});
