import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_evaluate } from "ai";
import type { TResumeRowContent } from "@/utils/types";
import { shortlistResumes } from "./shortlist-resumes";
import type { RankableResume } from "./rank-resumes-for-job";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  experimental_evaluate: vi.fn(),
}));
vi.mock("@ai-sdk/typesafe-ai", () => ({ typeSafeAi: { evaluationModel: vi.fn(() => "jev") } }));

const evaluate = vi.mocked(experimental_evaluate);

const JOB = { title: "Backend Engineer", company: "Acme", description: "We need Go and Kubernetes." };

// The resume's only bullet is its id, so the script can find it in the state.
const resume = (id: string): RankableResume => ({
  id,
  name: id,
  content: { sections: [{ type: "skills", items: [{ bullets: [{ text: id }] }] }] } as TResumeRowContent,
});

/** [skills, experience] per resume id; a string makes the evaluation throw. */
function scriptScores(byId: Record<string, [number, number] | string>) {
  evaluate.mockImplementation((async ({ state }: { state: { target: { resume: string } } }) => {
    const id = state.target.resume.split("- ")[1];
    const answers = byId[id];
    if (typeof answers === "string") throw new Error(answers);
    return {
      answers: {
        skillsMatch: { type: "score", score: answers[0] },
        experienceMatch: { type: "score", score: answers[1] },
      },
    } as never;
  }) as never);
}

const ids = (resumes: RankableResume[]) => resumes.map((r) => r.id);

beforeEach(() => {
  evaluate.mockReset();
});

describe("shortlistResumes", () => {
  it("doesn't call jev when there are no more resumes than the shortlist holds", async () => {
    const resumes = ["a", "b"].map(resume);
    expect(await shortlistResumes(JOB, resumes, 2)).toBe(resumes);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("keeps the best by 0.6·skills + 0.4·experience, in the caller's order", async () => {
    scriptScores({
      a: [1, 1], // 1.0
      b: [4, 0], // 2.4
      c: [2, 4], // 2.8
      d: [3, 3], // 3.0
    });

    const shortlist = await shortlistResumes(JOB, ["a", "b", "c", "d"].map(resume), 2);

    expect(ids(shortlist)).toEqual(["c", "d"]);
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(evaluate.mock.calls[0][0]).toMatchObject({
      model: "jev",
      state: { reference: JOB, target: { resume: "## skills\n- a" } },
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
  });

  it("breaks ties by the caller's order, so the primary resume stays in", async () => {
    scriptScores({ primary: [2, 2], newer: [2, 2], newest: [2, 2] });

    const shortlist = await shortlistResumes(JOB, ["primary", "newer", "newest"].map(resume), 2);

    expect(ids(shortlist)).toEqual(["primary", "newer"]);
  });

  it("sorts a failed evaluation last instead of dropping it", async () => {
    scriptScores({ a: "jev down", b: [1, 1], c: [3, 3] });

    expect(ids(await shortlistResumes(JOB, ["a", "b", "c"].map(resume), 2))).toEqual(["b", "c"]);
  });

  it("falls back to the caller's order when every evaluation fails", async () => {
    scriptScores({ a: "down", b: "down", c: "down" });

    expect(ids(await shortlistResumes(JOB, ["a", "b", "c"].map(resume), 2))).toEqual(["a", "b"]);
  });

  it("runs at most 10 evaluations at once", async () => {
    let inFlight = 0;
    let peak = 0;
    evaluate.mockImplementation((async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return {
        answers: { skillsMatch: { type: "score", score: 1 }, experienceMatch: { type: "score", score: 1 } },
      } as never;
    }) as never);

    const resumes = Array.from({ length: 30 }, (_, i) => resume(`r${i}`));
    expect(await shortlistResumes(JOB, resumes, 5)).toHaveLength(5);
    expect(evaluate).toHaveBeenCalledTimes(30);
    expect(peak).toBe(10);
  });
});
