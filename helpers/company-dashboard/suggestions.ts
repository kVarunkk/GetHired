// Client-safe and pure. The company dashboard's agent chips (CD-REQ-013):
// prompts about the company's own jobs first, then the role's starters.

import type { AgentSuggestion } from "@/components/agent/AskAgentBox";
import type { NeedsAttention as WaitingApplication } from "@/helpers/pipeline/funnel";

export const MAX_COMPANY_SUGGESTIONS = 4;
export const MAX_CONTEXTUAL_SUGGESTIONS = 2;
const MAX_TITLE_CHARS = 60;
/** `get_company_funnel` returns at most this many waiting rows, so a full list can't be counted. */
const WAITING_ROWS_LIMIT = 20;

/** The recruiter tools a chip can lead to. */
export type SuggestionTool = "listApplicants" | "findPoolCandidates" | "findMatchesForJob" | "reviewJobApproval";

/** A job that opened recently. */
export type NewJob = {
  id: string;
  title: string;
  /** The company's candidates matching it, or null when that wasn't counted. */
  poolMatches: number | null;
  /** Whether matching has ever run for it. */
  hasMatchingRun: boolean;
};

/** A job title as one short line: it goes into a prompt and a chip. */
export function promptJobTitle(title: string): string {
  const line = title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}

const chip = (prompt: string): AgentSuggestion => ({ label: prompt, prompt });

export function companyDashboardSuggestions({
  waiting,
  newJobs,
  pendingApproval,
  starters,
  allowed,
}: {
  waiting: WaitingApplication[];
  newJobs: NewJob[];
  pendingApproval: { id: string; title: string }[];
  starters: readonly string[];
  /** Whether the member has the tool's permission on the job. */
  allowed: (tool: SuggestionTool, jobId: string) => boolean;
}): AgentSuggestion[] {
  const own: AgentSuggestion[] = [];

  // The job with the most applicants waiting.
  const perJob = new Map<string, { title: string; count: number }>();
  for (const row of waiting) {
    if (!allowed("listApplicants", row.jobPostId)) continue;
    const entry = perJob.get(row.jobPostId) ?? { title: row.jobTitle, count: 0 };
    entry.count += 1;
    perJob.set(row.jobPostId, entry);
  }
  const busiest = [...perJob.values()].sort((a, b) => b.count - a.count)[0];
  if (busiest) {
    const title = promptJobTitle(busiest.title);
    const counted = waiting.length < WAITING_ROWS_LIMIT;
    own.push(
      chip(
        !counted
          ? `Review the applicants waiting on ${title}`
          : busiest.count === 1
            ? `Review the applicant waiting on ${title}`
            : `Review the ${busiest.count} applicants waiting on ${title}`,
      ),
    );
  }

  const withMatches = newJobs.find((job) => (job.poolMatches ?? 0) > 0 && allowed("findPoolCandidates", job.id));
  if (withMatches) own.push(chip(`Who in my candidates fits ${promptJobTitle(withMatches.title)}?`));

  const unmatched = newJobs.find(
    (job) => job.id !== withMatches?.id && !job.hasMatchingRun && allowed("findMatchesForJob", job.id),
  );
  if (unmatched) own.push(chip(`Find candidates for ${promptJobTitle(unmatched.title)}`));

  const approval = pendingApproval.find((job) => allowed("reviewJobApproval", job.id));
  if (approval) own.push(chip(`Review ${promptJobTitle(approval.title)} for approval`));

  return [...own.slice(0, MAX_CONTEXTUAL_SUGGESTIONS), ...starters.map(chip)].slice(0, MAX_COMPANY_SUGGESTIONS);
}
