import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_evaluate } from "ai";
import { rerankWithJev } from "./rerank-jev";
import type { AllJobWithRelations, CandidateState, JobPostingsRow } from "./types";

vi.mock("ai", () => ({ experimental_evaluate: vi.fn() }));
vi.mock("@ai-sdk/typesafe-ai", () => ({ typeSafeAi: { evaluationModel: vi.fn(() => "jev") } }));

const evaluate = vi.mocked(experimental_evaluate);

const score = (s: number) => ({ type: "score" as const, score: s });
const bool = (p: number) => ({ type: "boolean" as const, probability: p });

/** Answers per item id; a string value makes the evaluation throw. */
function scriptAnswers(byId: Record<string, Record<string, unknown> | string>) {
  evaluate.mockImplementation((async ({ state }: { state: Record<string, Record<string, unknown>> }) => {
    // Profile mode puts the candidate in `target` without an id, so look it up by skills text.
    const id =
      (state.target?.id as string | undefined) ??
      Object.keys(byId).find((k) => String(state.target?.skills).startsWith(k))!;
    const answers = byId[id];
    if (typeof answers === "string") throw new Error(answers);
    return { answers } as never;
  }) as never);
}

const JOB = { id: "job-1", title: "Frontend", description: "React" } as JobPostingsRow;

const candidate = (id: string): CandidateState =>
  ({ id, preferences: {}, skillsText: id, experienceText: "", projectsText: "" }) as CandidateState;

const profileAnswers = (skills: number, experience: number, mismatch = 0.1) => ({
  skillsMatch: score(skills),
  experienceMatch: score(experience),
  preferenceMismatch: bool(mismatch),
});

const rerankProfiles = (ids: string[]) =>
  rerankWithJev({ type: "relevant_profiles", reference: JOB, items: ids.map(candidate) });

beforeEach(() => {
  evaluate.mockReset();
});

describe("rerankWithJev, relevant_profiles (characterisation)", () => {
  it("sorts kept ids by 0.6·skills + 0.4·experience", async () => {
    scriptAnswers({
      a: profileAnswers(2, 4), // 2.8
      b: profileAnswers(4, 1), // 2.8
      c: profileAnswers(3, 3), // 3.0
      d: profileAnswers(2, 0), // 1.2
    });

    const result = await rerankProfiles(["a", "b", "c", "d"]);

    expect(result.reranked_job_ids?.[0]).toBe("c");
    expect(result.reranked_job_ids?.at(-1)).toBe("d");
    expect(result.reranked_job_ids).toHaveLength(4);
    expect(result.filtered_out_ids).toEqual([]);
  });

  it("filters a preference mismatch at probability 0.8 or more", async () => {
    scriptAnswers({ a: profileAnswers(4, 4, 0.8), b: profileAnswers(4, 4, 0.79) });

    const result = await rerankProfiles(["a", "b"]);

    expect(result.reranked_job_ids).toEqual(["b"]);
    expect(result.filtered_out_ids).toEqual(["a"]);
  });

  it("filters skills below 1.8", async () => {
    scriptAnswers({ a: profileAnswers(1.79, 4), b: profileAnswers(1.8, 0) });

    const result = await rerankProfiles(["a", "b"]);

    expect(result.reranked_job_ids).toEqual(["b"]);
    expect(result.filtered_out_ids).toEqual(["a"]);
  });

  it("filters an item whose evaluation throws", async () => {
    scriptAnswers({ a: "rerank down", b: profileAnswers(3, 3) });

    const result = await rerankProfiles(["a", "b"]);

    expect(result.reranked_job_ids).toEqual(["b"]);
    expect(result.filtered_out_ids).toEqual(["a"]);
  });
});

describe("rerankWithJev, other modes (characterisation)", () => {
  const job = (id: string) => ({ id, job_name: id, description: "" }) as AllJobWithRelations;

  it("sorts job_digest by 0.5·skills + 0.3·experience + 0.2·role + 0.1·location", async () => {
    const digest = (skills: number, exp: number, role: number, loc: number) => ({
      skillsMatch: score(skills),
      experienceMatch: score(exp),
      roleAlignment: score(role),
      preferenceMismatch: bool(0),
      locationMatch: score(loc),
    });
    scriptAnswers({ j1: digest(2, 2, 2, 2), j2: digest(4, 4, 3, 2), j3: digest(1, 4, 3, 2) });

    const result = await rerankWithJev({
      type: "job_digest",
      reference: candidate("me"),
      items: [job("j1"), job("j2"), job("j3")],
    });

    expect(result.reranked_job_ids).toEqual(["j2", "j1"]);
    expect(result.filtered_out_ids).toEqual(["j3"]);
  });

  it("sorts similar_jobs by 0.4·stack + 0.3·role + 0.2·scope + 0.1·location", async () => {
    const similar = (stack: number, role: number, scope: number, loc: number) => ({
      techStackOverlap: score(stack),
      roleSimilarity: score(role),
      scopeAlignment: score(scope),
      locationMatch: score(loc),
    });
    scriptAnswers({ j1: similar(2, 4, 2, 2), j2: similar(4, 1, 0, 0), j3: similar(1, 4, 2, 2) });

    const result = await rerankWithJev({
      type: "similar_jobs",
      reference: job("ref"),
      items: [job("j1"), job("j2"), job("j3")],
    });

    // j1: 0.8+1.2+0.4+0.2 = 2.6; j2: 1.6+0.3 = 1.9
    expect(result.reranked_job_ids).toEqual(["j1", "j2"]);
    expect(result.filtered_out_ids).toEqual(["j3"]);
  });
});

describe("rerankWithJev scores (MT-TEST-001)", () => {
  it("returns criterion scores and the aggregate for kept ids only", async () => {
    scriptAnswers({
      a: profileAnswers(3, 2, 0.25),
      b: profileAnswers(1, 4), // filtered: skills
      c: "rerank down", // filtered: failed
      d: profileAnswers(4, 4, 0.9), // filtered: preference conflict
    });

    const result = await rerankProfiles(["a", "b", "c", "d"]);

    expect(result.scores).toEqual({
      a: { skills: 3, experience: 2, preferenceConflict: 0.25, aggregate: 3 * 0.6 + 2 * 0.4 },
    });
  });

  it("keeps the aggregate equal to the sort key", async () => {
    scriptAnswers({ a: profileAnswers(2, 4), c: profileAnswers(3, 3) });

    const result = await rerankProfiles(["a", "c"]);
    const ordered = result.reranked_job_ids!.map((id) => result.scores![id].aggregate);

    expect(ordered).toEqual([...ordered].sort((x, y) => y - x));
    expect(result.scores!.c.aggregate).toBeCloseTo(3);
  });

  it("treats a missing preference answer as no conflict", async () => {
    scriptAnswers({ a: { skillsMatch: score(3), experienceMatch: score(3) } });

    const result = await rerankProfiles(["a"]);

    expect(result.scores!.a.preferenceConflict).toBe(0);
  });

  it("returns no scores in the other modes", async () => {
    scriptAnswers({
      j1: {
        skillsMatch: score(3),
        experienceMatch: score(3),
        roleAlignment: score(3),
        preferenceMismatch: bool(0),
        locationMatch: score(2),
      },
    });

    const result = await rerankWithJev({
      type: "job_digest",
      reference: candidate("me"),
      items: [{ id: "j1", job_name: "j1" } as AllJobWithRelations],
    });

    expect(result.scores ?? {}).toEqual({});
  });
});
