import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AllProfileWithRelations } from "@/utils/types";
import { CANDIDATE_PROFILE, PII, RESUME_CONTENT } from "@/test/utils/matching";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankWithJev } from "@/utils/rerank-jev";
import { reportError } from "@/helpers/posthog/report-error";
import { publicResumeContent, rerankProfilesIfApplicable } from "./ai-rerank-profiles";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/rerank-jev", () => ({ rerankWithJev: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const JOB = { id: "job-1", title: "Backend engineer", description: "Node", location: ["Remote"] };
const fetchMock = vi.fn();
let admin: SupabaseMock;

const profile = (id: string) =>
  ({
    ...CANDIDATE_PROFILE,
    user_id: id,
    resumes: [{ content: RESUME_CONTENT, is_primary: true }],
  }) as unknown as AllProfileWithRelations;

const PROFILES = ["u1", "u2", "u3"].map(profile);

type Args = Parameters<typeof rerankProfilesIfApplicable>[0];
const run = (overrides: Partial<Args> = {}) =>
  rerankProfilesIfApplicable({
    initialProfiles: [...PROFILES],
    initialCount: PROFILES.length,
    jobId: "job-1",
    cursor: null,
    companyId: "company-1",
    relevanceSearchType: "digest",
    ...overrides,
  });

const rerankOk = (ids: string[], filteredOut: string[] = [], scores = {}) =>
  vi.mocked(rerankWithJev).mockResolvedValue({
    reranked_job_ids: ids,
    filtered_out_ids: filteredOut,
    scores,
  });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  admin = createSupabaseMock();
  admin.queue("job_postings", { data: JOB, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
});

describe("rerankProfilesIfApplicable (QF-REQ-001/003/004)", () => {
  it("reranks against the company's job directly, with no call to the app over HTTP", async () => {
    rerankOk(["u1", "u2", "u3"]);

    await run();

    expect(fetchMock).not.toHaveBeenCalled();
    const args = vi.mocked(rerankWithJev).mock.calls[0][0];
    expect(args.type).toBe("relevant_profiles");
    expect(args.reference).toEqual(JOB);
    expect(args.items.map((c) => (c as { id: string }).id)).toEqual(["u1", "u2", "u3"]);

    const [jobQuery] = admin.callsFor("job_postings");
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["id", "job-1"] });
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["company_id", "company-1"] });
  });

  it("skips the rerank and keeps the vector order for another company's job", async () => {
    admin = createSupabaseMock();
    admin.queue("job_postings", { data: null, error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);

    const result = await run();

    expect(rerankWithJev).not.toHaveBeenCalled();
    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["u1", "u2", "u3"]);
    expect(result.totalCount).toBe(3);
    expect(result.matchScores).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("doesn't send full_name to the rerank (MT-SEC-002)", async () => {
    rerankOk([]);

    await run();

    const items = vi.mocked(rerankWithJev).mock.calls[0][0].items;
    expect(items).toHaveLength(3);
    for (const c of items) expect(c).not.toHaveProperty("full_name");
    expect(JSON.stringify(items)).not.toContain(PII.name);
  });

  it("reorders by the rerank, drops filtered-out and duplicate ids, and returns its scores", async () => {
    const scores = {
      u3: { skills: 4, experience: 3, preferenceConflict: 0, aggregate: 3.6 },
      u1: { skills: 2, experience: 2, preferenceConflict: 0.2, aggregate: 2 },
    };
    rerankOk(["u3", "u3", "u1", "u2"], ["u2"], scores);

    const result = await run();

    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["u3", "u1"]);
    expect(result.totalCount).toBe(2);
    expect(result.matchScores).toEqual(scores);
  });

  it("reranks the first 50 profiles and appends the rest in their order", async () => {
    const many = Array.from({ length: 53 }, (_, i) => profile(`p${i}`));
    rerankOk(["p1", "p0"]);

    const result = await run({ initialProfiles: many, initialCount: 53 });

    expect(vi.mocked(rerankWithJev).mock.calls[0][0].items).toHaveLength(50);
    expect(result.initialProfiles.map((p) => p.user_id)).toEqual(["p1", "p0", "p50", "p51", "p52"]);
  });

  it("keeps the original order and count, with no matchScores, when the rerank throws", async () => {
    vi.mocked(rerankWithJev).mockRejectedValue(new Error("rerank down"));
    const many = Array.from({ length: 53 }, (_, i) => profile(`p${i}`));

    const result = await run({ initialProfiles: many, initialCount: 53 });

    expect(result.initialProfiles).toHaveLength(53);
    expect(result.totalCount).toBe(53);
    expect(result.matchScores).toBeUndefined();
    expect(reportError).toHaveBeenCalled();
  });

  it.each<[string, Partial<Args>]>([
    ["a cursor", { cursor: "c2" }],
    ["an empty list", { initialProfiles: [], initialCount: 0 }],
    ["a standard read", { relevanceSearchType: "standard" }],
    ["no relevance search", { relevanceSearchType: null }],
    ["a digest with no job", { jobId: null }],
  ])("does nothing for %s", async (_label, overrides) => {
    const result = await run(overrides);

    expect(rerankWithJev).not.toHaveBeenCalled();
    expect(admin.callsFor("job_postings")).toHaveLength(0);
    expect(result.matchScores).toBeUndefined();
  });
});

describe("publicResumeContent (ORT-045)", () => {
  const SECTIONS = [{ type: "skills", items: [{ bullets: [{ text: "React" }] }] }];

  it("never reads the raw resume content", () => {
    const content = publicResumeContent({
      ...CANDIDATE_PROFILE,
      resumes: [{ content: RESUME_CONTENT, is_primary: true }],
    } as AllProfileWithRelations);

    expect(content).toEqual({ sections: [] });
    expect(JSON.stringify(content)).not.toContain(PII.resumeEmail);
  });

  it("reads resume_sections from candidate_directory", () => {
    expect(publicResumeContent({ ...CANDIDATE_PROFILE, resume_sections: SECTIONS } as AllProfileWithRelations)).toEqual({
      sections: SECTIONS,
    });
  });

  it.each([
    ["an object", { sections: SECTIONS }],
    ["an array", [{ sections: SECTIONS }]],
  ])("reads the stored public sections embedded as %s", (_, embedded) => {
    const profile = {
      ...CANDIDATE_PROFILE,
      resumes: [{ is_primary: true, resume_public_sections: embedded }],
    } as AllProfileWithRelations;
    expect(publicResumeContent(profile)).toEqual({ sections: SECTIONS });
  });

  it("sends the rerank no resume PII", async () => {
    rerankOk([]);
    await run();
    const body = JSON.stringify(vi.mocked(rerankWithJev).mock.calls[0][0].items);
    for (const value of [PII.resumeEmail, PII.resumePhone, PII.resumeUrl]) expect(body).not.toContain(value);
  });
});
