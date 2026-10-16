import { tool } from "ai";
import { z } from "zod";
import {
  OUTREACH_MESSAGE_MAX,
  OUTREACH_PAGE_SIZE,
  OUTREACH_STATUSES,
  OUTREACH_SUBJECT_MAX,
} from "@/helpers/outreach/config";
import { listCompanyOutreach } from "@/helpers/outreach/list";
import { sendOutreach } from "@/helpers/outreach/send";
import {
  candidateUrl,
  fairnessError,
  OUTREACH_URL,
  planLimitError,
  type RecruiterToolContext,
  uuidInput,
  withToolErrors,
} from "./shared";

const LIST_DEFAULT = 10;

/** sendOutreach's input, shared with the approval card's preview (`previewAgentOutreachAction`). */
export const sendOutreachInput = z.object({
  candidateId: uuidInput("candidate"),
  jobPostId: uuidInput("job post").optional(),
  subject: z.string().trim().min(1).max(OUTREACH_SUBJECT_MAX),
  message: z.string().trim().min(1).max(OUTREACH_MESSAGE_MAX).describe("Plain text. The candidate answers on GetHired."),
});

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** The outreach tools (RA-TASK-050), on top of `helpers/outreach/*` (RA-CON-003). */
export function createOutreachTools(ctx: RecruiterToolContext) {
  const { supabase, company, user } = ctx;

  return {
    sendOutreach: tool({
      description:
        "Send one candidate from the talent pool a message on GetHired, optionally about one of the company's jobs. Uses one outreach from this month's plan. Write the subject and message yourself from the job and the candidate's profile. The candidate answers on GetHired; their contact details are shared only if they answer Interested.",
      inputSchema: sendOutreachInput,
      execute: (input) =>
        withToolErrors(ctx, "sendOutreach", async () => {
          const unfair = fairnessError([input.subject, input.message], "job_post");
          if (unfair) return unfair;

          // The company, the sender and the source come from the session (RA-SEC-002).
          const result = await sendOutreach({ supabase, company, user }, input, { source: "agent" });
          if (!result.ok) {
            if ("code" in result) return { error: result.code, message: result.error };
            return planLimitError(result.error);
          }
          return {
            sent: true,
            outreachId: result.outreach.id,
            status: result.outreach.status,
            emailed: result.emailed,
            candidateUrl: candidateUrl(result.outreach.candidate_user_id),
            outreachUrl: OUTREACH_URL,
          };
        }),
    }),

    listOutreach: tool({
      description:
        "List the company's outreach messages, newest first, with each candidate's answer and the reply rate. Filter by job or status.",
      inputSchema: z.object({
        jobPostId: uuidInput("job post").optional(),
        status: z.enum(OUTREACH_STATUSES).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(OUTREACH_PAGE_SIZE)
          .optional()
          .describe(`How many messages to return (default ${LIST_DEFAULT}).`),
      }),
      execute: ({ jobPostId, status, limit }) =>
        withToolErrors(ctx, "listOutreach", async () => {
          const page = await listCompanyOutreach(
            { supabase, company },
            { jobPostId: jobPostId ?? null, status: status ?? null },
          );
          const shown = page.items.slice(0, limit ?? LIST_DEFAULT);
          return {
            replyRate: page.replyRate,
            outreach: shown.map((o) => ({
              id: o.id,
              candidate: { id: o.candidateUserId, name: o.candidateName, url: candidateUrl(o.candidateUserId) },
              job: o.jobTitle,
              subject: o.subject,
              status: o.status,
              sentAt: day(o.sentAt),
              respondedAt: day(o.respondedAt),
            })),
            hasMore: page.items.length > shown.length || page.nextCursor !== null,
            url: OUTREACH_URL,
          };
        }),
    }),
  };
}
