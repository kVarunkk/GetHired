import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { explainCandidateMatch } from "@/helpers/matching/explain-candidate-match";
import { queueJobScreenings } from "@/helpers/matching/queue-screenings";
import { planLimitError, type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

const MODEL_FAILURE = { error: "Couldn't explain this match right now. Please try again." } as const;

/** Tools from the matching spec (RA phase 3). */
export function createMatchingTools(ctx: RecruiterToolContext) {
  return {
    explainMatch: tool({
      description:
        "Explain why a candidate fits one of the company's jobs: a summary, strengths, gaps and conflicts with their preferences. Cached after the first time; a new explanation uses one from the plan's monthly allowance.",
      inputSchema: z.object({
        candidateId: uuidInput("candidate"),
        jobPostId: uuidInput("job post"),
      }),
      execute: ({ candidateId, jobPostId }, { abortSignal }) =>
        withToolErrors(ctx, "explainMatch", async () => {
          const result = await explainCandidateMatch(ctx, { candidateId, jobPostId }, { abortSignal });
          if (result.ok) {
            return {
              candidateId,
              jobPostId,
              // Derived from candidate text, so sandboxed (RA-SEC-003).
              explanation: wrapInSandbox("match_explanation", JSON.stringify(result.explanation)),
            };
          }
          if (result.reason === "not_found") return { error: "Candidate or job post not found." };
          if (result.reason === "entitlement") {
            return planLimitError({ ...result.error.payload, message: result.error.message });
          }
          return MODEL_FAILURE;
        }),
    }),

    screenApplicants: tool({
      description:
        "Queue AI screening for every unscreened (or stale or failed) application to one of the company's jobs. Screening takes a few minutes; listApplicants then shows fit scores. Each new screening uses one from the plan's monthly allowance.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "screenApplicants", async () => {
          const result = await queueJobScreenings(ctx, jobPostId);
          if (result.ok) return { jobPostId, queued: result.queued };
          if (result.reason === "not_found") return { error: "Job post not found." };
          if (result.reason === "entitlement") {
            return planLimitError({ ...result.error.payload, message: result.error.message });
          }
          return { error: "Couldn't queue the screenings. Please try again." };
        }),
    }),
  };
}
