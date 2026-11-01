import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandLocations } from "@/helpers/locations/aliases";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  CANDIDATES_PAGE_SIZE,
  candidateFiltersFrom,
  listCandidateFilterOptions,
  listCompanyCandidates,
  type CompanyCandidateListItem,
} from "./list-candidates";

vi.mock("@/helpers/locations/aliases", () => ({ expandLocations: vi.fn() }));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const LIST = "70000000-0000-4000-8000-000000000001";

const row = {
  id: "cc000000-0000-4000-8000-000000000001",
  full_name: "Meera Iyer",
  email: "meera@mail.test",
  current_title: "Backend Engineer",
  location: "bengaluru",
  tags: ["referral"],
  created_at: "2026-10-25T00:00:00.000Z",
  source_batch_id: BATCH,
  candidate_import_batches: { file_name: "people.csv" },
  applications: [{ count: 2 }],
};

const MATCH_JOB = "b0000000-0000-4000-8000-000000000001";
const cid = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;
const NO_FILTERS = {
  q: null,
  tag: null,
  batchId: null,
  inJob: null,
  loc: null,
  resume: null,
  email: null,
  addedDays: null,
  matchJob: null,
  page: 1,
};

beforeEach(() => {
  vi.mocked(expandLocations).mockImplementation(async (names) =>
    names.flatMap((n) => (n.toLowerCase() === "bangalore" ? ["bangalore", "bengaluru"] : [n.toLowerCase()])),
  );
});
afterEach(() => vi.useRealTimers());

describe("candidateFiltersFrom (BI-REQ-003)", () => {
  it("reads the filters and page from the URL, ignoring junk", () => {
    expect(
      candidateFiltersFrom({ q: " meera ", tag: "referral", batch: BATCH, inJob: "no", page: "3" }),
    ).toEqual({ ...NO_FILTERS, q: "meera", tag: "referral", batchId: BATCH, inJob: "no", page: 3 });
    expect(candidateFiltersFrom({ batch: "nope", inJob: "maybe", page: "-1" })).toEqual(NO_FILTERS);
  });

  it("reads the location, resume, email and added filters (CPT-034, CP-REQ-071)", () => {
    expect(candidateFiltersFrom({ loc: " Bangalore ", resume: "has", email: "none", added: "30" })).toEqual({
      ...NO_FILTERS,
      loc: "Bangalore",
      resume: "has",
      email: "none",
      addedDays: 30,
    });
    expect(candidateFiltersFrom({ loc: " ", resume: "maybe", email: "any", added: "45" })).toEqual(NO_FILTERS);
  });

  it("reads the match-to-job filter, a job id only (CPT-056)", () => {
    expect(candidateFiltersFrom({ matchJob: MATCH_JOB })).toEqual({ ...NO_FILTERS, matchJob: MATCH_JOB });
    expect(candidateFiltersFrom({ matchJob: "nope" })).toEqual(NO_FILTERS);
  });
});

describe("listCompanyCandidates (BI-REQ-003)", () => {
  it("pages the company's candidates, newest first, with their batch and job count", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: [row], error: null, count: 41 });

    const result = await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ page: "2" }));

    expect(result).toEqual({
      total: 41,
      page: 2,
      pageSize: CANDIDATES_PAGE_SIZE,
      items: [
        {
          id: row.id,
          name: "Meera Iyer",
          email: "meera@mail.test",
          title: "Backend Engineer",
          location: "bengaluru",
          tags: ["referral"],
          batch: { id: BATCH, fileName: "people.csv" },
          jobCount: 2,
          createdAt: row.created_at,
          score: null,
        } satisfies CompanyCandidateListItem,
      ],
    });
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
    expect(chain).toContainEqual({ method: "range", args: [CANDIDATES_PAGE_SIZE, 2 * CANDIDATES_PAGE_SIZE - 1] });
    // Never the notes, the resume, the claim columns, the embedding or search_text (CP-SEC-002).
    const columns = String(chain.find((m) => m.method === "select")!.args[0]);
    expect(columns).not.toMatch(/notes|resume|claimed|opted|embedding|search_text/);
  });

  it("builds the text, tag, batch, in-a-job and list filters", async () => {
    const db = createSupabaseMock();
    await listCompanyCandidates(db.client, COMPANY_A.id, {
      ...candidateFiltersFrom({ q: "meera,(x)", tag: "referral", batch: BATCH, inJob: "yes" }),
      listId: LIST,
    });

    const { chain } = db.callsFor("company_candidates")[0];
    // One ilike on the trigram column: name, email, title, company and skills (CP-REQ-070).
    expect(chain).toContainEqual({ method: "ilike", args: ["search_text", "%meera x%"] });
    expect(chain.filter((m) => m.method === "or")).toHaveLength(0);
    expect(chain).toContainEqual({ method: "contains", args: ["tags", ["referral"]] });
    expect(chain).toContainEqual({ method: "eq", args: ["source_batch_id", BATCH] });
    expect(chain).toContainEqual({ method: "eq", args: ["talent_list_members.list_id", LIST] });
    const columns = String(chain.find((m) => m.method === "select")!.args[0]);
    expect(columns).toContain("in_job:applications!inner(id)");
    expect(columns).toContain("talent_list_members!inner(list_id)");
  });

  it("searches skills, lower-cased, through search_text", async () => {
    const db = createSupabaseMock();
    await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ q: "PostgreSQL" }));
    expect(db.callsFor("company_candidates")[0].chain).toContainEqual({
      method: "ilike",
      args: ["search_text", "%postgresql%"],
    });
  });

  it("matches every spelling of a location (CPT-034)", async () => {
    const db = createSupabaseMock();
    await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ loc: "Bangalore" }));

    expect(expandLocations).toHaveBeenCalledWith(["Bangalore"]);
    expect(db.callsFor("company_candidates")[0].chain).toContainEqual({
      method: "or",
      args: ["location.ilike.%bangalore%,location.ilike.%bengaluru%"],
    });
  });

  it("filters by resume, email and when they were added", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-26T12:00:00.000Z"), toFake: ["Date"] });
    const db = createSupabaseMock();
    await listCompanyCandidates(
      db.client,
      COMPANY_A.id,
      candidateFiltersFrom({ resume: "has", email: "none", added: "7" }),
    );
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "not", args: ["resume_content", "is", null] });
    expect(chain).toContainEqual({ method: "is", args: ["email", null] });
    expect(chain).toContainEqual({ method: "gte", args: ["created_at", "2026-10-19T12:00:00.000Z"] });

    const db2 = createSupabaseMock();
    await listCompanyCandidates(db2.client, COMPANY_A.id, candidateFiltersFrom({ resume: "none", email: "has" }));
    const chain2 = db2.callsFor("company_candidates")[0].chain;
    expect(chain2).toContainEqual({ method: "is", args: ["resume_content", null] });
    expect(chain2).toContainEqual({ method: "not", args: ["email", "is", null] });
    expect(chain2.filter((m) => m.method === "gte")).toHaveLength(0);
  });

  it("combines the filters", async () => {
    const db = createSupabaseMock();
    await listCompanyCandidates(
      db.client,
      COMPANY_A.id,
      candidateFiltersFrom({ q: "go", loc: "pune", resume: "has", tag: "referral" }),
    );
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "ilike", args: ["search_text", "%go%"] });
    expect(chain).toContainEqual({ method: "or", args: ["location.ilike.%pune%"] });
    expect(chain).toContainEqual({ method: "not", args: ["resume_content", "is", null] });
    expect(chain).toContainEqual({ method: "contains", args: ["tags", ["referral"]] });
  });

  it("matches to a job: the RPC's candidates only, by similarity, with the other filters (CPT-056)", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_company_candidates", {
      data: {
        ok: true,
        job_embedded: true,
        pool_size: 9,
        matches: [
          { company_candidate_id: cid(3), similarity: 0.84 },
          { company_candidate_id: cid(1), similarity: 0.7 },
          { company_candidate_id: cid(2), similarity: 0.6 },
        ],
      },
      error: null,
    });
    db.queue("company_candidates", {
      data: [{ ...row, id: cid(1) }, { ...row, id: cid(2) }, { ...row, id: cid(3) }],
      error: null,
      count: 3,
    });

    const result = await listCompanyCandidates(
      db.client,
      COMPANY_A.id,
      candidateFiltersFrom({ matchJob: MATCH_JOB, q: "go", loc: "pune" }),
    );

    expect(db.callsFor("match_company_candidates")[0].chain[0].args[1]).toEqual({ p_job_id: MATCH_JOB, p_limit: 200 });
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "in", args: ["id", [cid(3), cid(1), cid(2)]] });
    expect(chain).toContainEqual({ method: "ilike", args: ["search_text", "%go%"] });
    expect(chain).toContainEqual({ method: "or", args: ["location.ilike.%pune%"] });
    // Sorted and paged here, by similarity.
    expect(chain.some((m) => m.method === "range" || m.method === "order")).toBe(false);
    expect(result.items.map((i) => [i.id, i.score])).toEqual([
      [cid(3), 97],
      [cid(1), 57],
      [cid(2), 29],
    ]);
    expect(result.total).toBe(3);
  });

  it("pages over the matched set", async () => {
    const db = createSupabaseMock();
    const ids = Array.from({ length: 30 }, (_, i) => `cc000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    db.queueRpc("match_company_candidates", {
      data: {
        ok: true,
        job_embedded: true,
        pool_size: 30,
        matches: ids.map((id, i) => ({ company_candidate_id: id, similarity: 0.9 - i / 100 })),
      },
      error: null,
    });
    db.queue("company_candidates", { data: ids.map((id) => ({ ...row, id })).reverse(), error: null, count: 30 });

    const result = await listCompanyCandidates(
      db.client,
      COMPANY_A.id,
      candidateFiltersFrom({ matchJob: MATCH_JOB, page: "2" }),
    );
    expect(result.total).toBe(30);
    expect(result.items.map((i) => i.id)).toEqual(ids.slice(CANDIDATES_PAGE_SIZE));
  });

  it("finds no one when nobody matches, and gives a plain list no score", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_company_candidates", {
      data: { ok: true, job_embedded: false, pool_size: 2, matches: [] },
      error: null,
    });
    expect(await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ matchJob: MATCH_JOB }))).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: CANDIDATES_PAGE_SIZE,
    });
    expect(db.callsFor("company_candidates")).toHaveLength(0);

    db.queue("company_candidates", { data: [row], error: null, count: 1 });
    const plain = await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({}));
    expect(plain.items[0].score).toBeNull();
  });

  it("throws when matching fails", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_company_candidates", { data: { ok: false, reason: "forbidden" }, error: null });
    await expect(
      listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ matchJob: MATCH_JOB })),
    ).rejects.toThrow(/match/);
  });

  it("finds candidates in no job", async () => {
    const db = createSupabaseMock();
    await listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({ inJob: "no" }));

    const { chain } = db.callsFor("company_candidates")[0];
    expect(String(chain.find((m) => m.method === "select")!.args[0])).toContain("in_job:applications(id)");
    expect(chain).toContainEqual({ method: "is", args: ["in_job", null] });
  });

  it("throws on a database error", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: null, error: { message: "boom" } });
    await expect(listCompanyCandidates(db.client, COMPANY_A.id, candidateFiltersFrom({}))).rejects.toThrow(/boom/);
  });
});

describe("listCandidateFilterOptions (BI-REQ-003)", () => {
  it("lists the company's tags once each, sorted, and its import files", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: [{ tags: ["referral", "Java"] }, { tags: ["referral"] }, { tags: [] }], error: null });
    db.queue("candidate_import_batches", { data: [{ id: BATCH, file_name: "people.csv" }], error: null });

    expect(await listCandidateFilterOptions(db.client, COMPANY_A.id)).toEqual({
      tags: ["Java", "referral"],
      batches: [{ id: BATCH, fileName: "people.csv" }],
    });
    const batches = db.callsFor("candidate_import_batches")[0].chain;
    expect(batches).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(batches).toContainEqual({ method: "eq", args: ["status", "confirmed"] });
    // A candidate added by hand has a batch with no file: not a filter option.
    expect(batches).toContainEqual({ method: "not", args: ["file_name", "is", null] });
  });

  it("returns no options on an error, since they're extra", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: null, error: { message: "boom" } });
    db.queue("candidate_import_batches", { data: null, error: { message: "boom" } });

    expect(await listCandidateFilterOptions(db.client, COMPANY_A.id)).toEqual({ tags: [], batches: [] });
  });
});
