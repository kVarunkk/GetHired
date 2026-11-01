import { describe, expect, it } from "vitest";
import { POOL_MATCH_LIMIT } from "@/helpers/matching/config";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import {
  listMatchingJobs,
  listPoolMatches,
  POOL_MATCH_MESSAGES,
} from "./pool-matches";

const JOB = "b0000000-0000-4000-8000-000000000001";
const JOB2 = "b0000000-0000-4000-8000-000000000002";
const c = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;

const person = (n: number) => ({
  id: c(n),
  full_name: `Person ${n}`,
  current_title: `Engineer ${n}`,
  location: "pune",
  experience_years: n,
  skills: ["Go"],
});
const ok = (matches: unknown[], extra: Record<string, unknown> = {}) => ({
  data: { ok: true, job_embedded: true, pool_size: 5, matches, ...extra },
  error: null,
});

describe("listPoolMatches (CPT-052, CP-REQ-050/060)", () => {
  it("keeps the RPC's order and adds the display columns", async () => {
    const db = createSupabaseMock();
    db.queueRpc(
      "match_company_candidates",
      ok([
        {
          company_candidate_id: c(2),
          similarity: 0.85,
          has_email: true,
          has_resume: true,
        },
        {
          company_candidate_id: c(1),
          similarity: 0.6,
          has_email: false,
          has_resume: false,
        },
      ]),
    );
    db.queue("company_candidates", {
      data: [person(1), person(2)],
      error: null,
    });

    const result = await listPoolMatches(db.client, JOB, { limit: 10 });

    expect(result).toEqual({
      ok: true,
      status: "ok",
      poolSize: 5,
      matches: [
        {
          id: c(2),
          name: "Person 2",
          title: "Engineer 2",
          location: "pune",
          experienceYears: 2,
          skills: ["Go"],
          hasEmail: true,
          hasResume: true,
          similarity: 0.85,
          score: 100,
        },
        expect.objectContaining({
          id: c(1),
          hasEmail: false,
          hasResume: false,
          score: 29,
        }),
      ],
    });
    expect(db.callsFor("match_company_candidates")[0].chain[0].args[1]).toEqual(
      { p_job_id: JOB, p_limit: 10 },
    );
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "in", args: ["id", [c(2), c(1)]] });
  });

  it("selects no contact details and never the embedding (CP-SEC-002)", async () => {
    const db = createSupabaseMock();
    db.queueRpc(
      "match_company_candidates",
      ok([{ company_candidate_id: c(1), similarity: 0.7 }]),
    );
    db.queue("company_candidates", { data: [person(1)], error: null });
    await listPoolMatches(db.client, JOB);

    const select = String(
      db
        .callsFor("company_candidates")[0]
        .chain.find((s) => s.method === "select")!.args[0],
    );
    expect(select).not.toMatch(
      /email|phone|links|notes|tags|embedding|search_text|resume/,
    );
    expect(db.callsFor("match_company_candidates")[0].chain[0].args[1]).toEqual(
      {
        p_job_id: JOB,
        p_limit: POOL_MATCH_LIMIT,
      },
    );
  });

  it("drops a match whose row it can't read", async () => {
    const db = createSupabaseMock();
    db.queueRpc(
      "match_company_candidates",
      ok([
        { company_candidate_id: c(1), similarity: 0.7 },
        { company_candidate_id: c(2), similarity: 0.6 },
      ]),
    );
    db.queue("company_candidates", { data: [person(2)], error: null });
    const result = await listPoolMatches(db.client, JOB);
    expect(result.ok && result.matches.map((m) => m.id)).toEqual([c(2)]);
  });

  it("shows a claimed candidate from the company's record, not the account (BIT-104)", async () => {
    const db = createSupabaseMock();
    db.queueRpc(
      "match_company_candidates",
      ok([{ company_candidate_id: c(3), similarity: 0.7 }]),
    );
    db.queue("company_candidates", {
      data: [
        {
          ...person(3),
          claimed_user_id: "a1000000-0000-4000-8000-000000000001",
        },
      ],
      error: null,
    });

    const result = await listPoolMatches(db.client, JOB);

    expect(result.ok && result.matches).toEqual([
      expect.objectContaining({
        id: c(3),
        name: "Person 3",
        title: "Engineer 3",
      }),
    ]);
    expect(db.callsFor("user_info")).toHaveLength(0);
  });

  it("says when the job isn't embedded yet, and when the pool is empty", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_company_candidates", ok([], { job_embedded: false }));
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: true,
      status: "no_job_embedding",
      poolSize: 5,
      matches: [],
    });

    db.queueRpc("match_company_candidates", ok([], { pool_size: 0 }));
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: true,
      status: "no_pool",
      poolSize: 0,
      matches: [],
    });

    db.queueRpc("match_company_candidates", ok([]));
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: true,
      status: "ok",
      poolSize: 5,
      matches: [],
    });
    expect(db.callsFor("company_candidates")).toHaveLength(0);
  });

  it("maps the RPC's reasons to copy", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_company_candidates", {
      data: { ok: false, reason: "forbidden" },
      error: null,
    });
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: false,
      error: POOL_MATCH_MESSAGES.forbidden,
    });
    expect(POOL_MATCH_MESSAGES.forbidden).toMatch(/^Your role can't/);

    db.queueRpc("match_company_candidates", {
      data: { ok: false, reason: "not_found" },
      error: null,
    });
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: false,
      error: POOL_MATCH_MESSAGES.not_found,
    });

    db.queueRpc("match_company_candidates", {
      data: null,
      error: { message: "down" },
    });
    expect(await listPoolMatches(db.client, JOB)).toEqual({
      ok: false,
      error: "Couldn't load matches. Try again.",
    });
  });
});

describe("listMatchingJobs (CPT-052, CP-REQ-062)", () => {
  it("lists the candidate's matching jobs in the RPC's order", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_jobs_for_company_candidate", {
      data: {
        ok: true,
        candidate_embedded: true,
        matches: [
          { job_post_id: JOB2, similarity: 0.8 },
          { job_post_id: JOB, similarity: 0.7 },
        ],
      },
      error: null,
    });
    db.queue("job_postings", {
      data: [
        { id: JOB, title: "Backend" },
        { id: JOB2, title: "Data" },
      ],
      error: null,
    });

    expect(await listMatchingJobs(db.client, c(1))).toEqual({
      ok: true,
      status: "ok",
      matches: [
        { jobId: JOB2, title: "Data", similarity: 0.8, score: 86 },
        { jobId: JOB, title: "Backend", similarity: 0.7, score: 57 },
      ],
    });
    expect(
      db.callsFor("match_jobs_for_company_candidate")[0].chain[0].args[1],
    ).toEqual({ p_candidate_id: c(1) });
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({
      method: "select",
      args: ["id, title"],
    });
  });

  it("says when the candidate isn't embedded, and maps reasons", async () => {
    const db = createSupabaseMock();
    db.queueRpc("match_jobs_for_company_candidate", {
      data: { ok: true, candidate_embedded: false, matches: [] },
      error: null,
    });
    expect(await listMatchingJobs(db.client, c(1))).toEqual({
      ok: true,
      status: "not_embedded",
      matches: [],
    });

    db.queueRpc("match_jobs_for_company_candidate", {
      data: { ok: false, reason: "forbidden" },
      error: null,
    });
    expect(await listMatchingJobs(db.client, c(1))).toEqual({
      ok: false,
      error: POOL_MATCH_MESSAGES.forbidden,
    });
  });
});
