import "server-only";
import { experimental_evaluate as evaluate } from "ai";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";
import type { ScoreReturnType } from "@/utils/types";
import { resumeText, type RankableResume, type ResumeRankingJob } from "./rank-resumes-for-job";

/** Most resumes one pick looks at; the newest beyond this are left out. */
export const RESUME_SHORTLIST_MAX = 50;
/** jev evaluations run at once. */
const SHORTLIST_CONCURRENCY = 10;
const DESCRIPTION_MAX_CHARS = 2000;

const QUESTIONS = {
  skillsMatch: {
    type: "score" as const,
    instructions: "How well do the skills and tools this resume shows cover the core requirements of the job?",
    criteria: [
      "Lacks the foundational skills the job needs",
      "Partial overlap with significant gaps",
      "Good coverage of the core skills",
      "Strong alignment with nearly all requirements",
      "Exact tech stack and tool match",
    ],
  },
  experienceMatch: {
    type: "score" as const,
    instructions: "How well does the experience this resume shows match the seniority and domain the job asks for?",
    criteria: [
      "Significantly under or over-qualified",
      "Seniority or domain gap present",
      "Acceptable experience match",
      "Strong match for the target level",
      "Ideal seniority and track record",
    ],
  },
};

type Answers = { [K in keyof typeof QUESTIONS]: ScoreReturnType };

/** Runs `fn` over `items` with at most `limit` in flight, keeping the order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Narrows the user's resumes to the `size` that fit the job best, scored by jev
 * (0.6·skills + 0.4·experience), so the evidence ranking only sees those. A
 * resume whose evaluation fails sorts last instead of dropping out, so if every
 * evaluation fails this keeps the first `size` in the caller's order. The
 * result keeps the caller's order too, so a tie in the ranking still goes to
 * the primary resume.
 */
export async function shortlistResumes<T extends RankableResume>(
  job: ResumeRankingJob,
  resumes: T[],
  size: number,
): Promise<T[]> {
  if (resumes.length <= size) return resumes;

  const reference = {
    title: job.title,
    company: job.company,
    description: job.description.slice(0, DESCRIPTION_MAX_CHARS),
  };

  const scores = await mapLimited(resumes, SHORTLIST_CONCURRENCY, async (resume) => {
    try {
      const result = await evaluate({
        model: typeSafeAi.evaluationModel("jev-latest"),
        state: { reference, target: { resume: resumeText(resume.content) } },
        questions: QUESTIONS,
        providerOptions: { gateway: { zeroDataRetention: true } },
      });
      const { skillsMatch, experienceMatch } = result.answers as Answers;
      return skillsMatch.score * 0.6 + experienceMatch.score * 0.4;
    } catch {
      return -1;
    }
  });

  // Stable sort, so equal scores (and failures) keep the caller's order.
  const kept = new Set(
    resumes
      .map((resume, index) => ({ index, score: scores[index] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, size)
      .map(({ index }) => index),
  );
  return resumes.filter((_, index) => kept.has(index));
}
