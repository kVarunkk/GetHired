import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllProfileWithRelations } from "@/utils/types";
import { CANDIDATE_PROFILE, PII, RESUME_CONTENT } from "@/test/utils/matching";
import { rerankProfilesIfApplicable } from "./ai-rerank-profiles";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000", cookie: "sb=1" }),
}));

const fetchMock = vi.fn();

const profile = (id: string) =>
  ({
    ...CANDIDATE_PROFILE,
    user_id: id,
    resumes: [{ content: RESUME_CONTENT, is_primary: true }],
  }) as unknown as AllProfileWithRelations;

const PROFILES = ["u1", "u2", "u3"].map(profile);

const run = () =>
  rerankProfilesIfApplicable({
    initialProfiles: [...PROFILES],
    initialCount: PROFILES.length,
    userId: "company-user",
    jobId: "job-1",
    aiCredits: 0,
    matchedProfileIds: [],
    cursor: null,
    companyId: "company-1",
    relevanceSearchType: "digest",
    isInternalCall: true,
  });

const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("rerankProfilesIfApplicable", () => {
  it("doesn't send full_name to the rerank (MT-SEC-002)", async () => {
    respond(200, { rerankedProfiles: [], filteredOutProfiles: [], scores: {} });

    await run();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.profiles).toHaveLength(3);
    for (const p of body.profiles) expect(p).not.toHaveProperty("full_name");
    expect(JSON.stringify(body)).not.toContain(PII.name);
  });

  it("reorders by the rerank and returns its scores as matchScores", async () => {
    const scores = {
      u3: { skills: 4, experience: 3, preferenceConflict: 0, aggregate: 3.6 },
      u1: { skills: 2, experience: 2, preferenceConflict: 0.2, aggregate: 2 },
    };
    respond(200, { rerankedProfiles: ["u3", "u1"], filteredOutProfiles: ["u2"], scores });

    const result = await run();

    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["u3", "u1"]);
    expect(result.matchScores).toEqual(scores);
  });

  it("keeps the original order and returns no matchScores when the rerank fails", async () => {
    respond(500, { message: "An error occurred" });

    const result = await run();

    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(result.matchScores).toBeUndefined();
  });

  it("returns no matchScores when the fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await run();

    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(result.matchScores).toBeUndefined();
  });
});
