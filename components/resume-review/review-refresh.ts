const POLL_MS = 2000;

export type ReviewTriggerState = "idle" | "saving_jd" | "triggering_analysis" | "triggering_parse";

type ReviewPollData = {
  resume_id?: string | null;
  status?: string | null;
  resumes?: { content?: unknown; parsing_failed?: boolean | null; resume_path?: string | null } | null;
} | null | undefined;

/**
 * How often the review page refetches. An upload now finishes before it
 * returns, so a parse only runs in the background for an old resume with a
 * stored file (a retry, or a message queued at deploy). That check goes with
 * the file fallbacks at cleanup (RE-REQ-099).
 */
export function reviewRefreshInterval(data: ReviewPollData, state: ReviewTriggerState): number {
  const resume = data?.resumes;
  const isParsingFile =
    (!!data?.resume_id && !!resume?.resume_path && !resume.content && !resume.parsing_failed) ||
    state === "triggering_parse";
  const isAnalyzing = data?.status === "processing" || state === "triggering_analysis";
  return isParsingFile || isAnalyzing ? POLL_MS : 0;
}
