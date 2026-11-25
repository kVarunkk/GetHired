// Client-safe. The dashboard agent box's suggestions: prompts about the user's
// own applications, interviews and matches first, then the general starters.

import type { AgentSuggestion } from "@/components/agent/AskAgentBox";
import { APPLICANT_STARTERS } from "@/components/agent/roles";
import { followUpPrompt, interviewPrepPrompt, tailorResumePrompt } from "@/helpers/tracker/agent-prompts";
import type { AttentionItem } from "./summary";

export const MAX_SUGGESTIONS = 4;

export function dashboardSuggestions({
  attention,
  nextInterview,
  topJob,
}: {
  attention: AttentionItem[];
  nextInterview: { interviewName: string; jobTitle: string; companyName: string } | null;
  topJob: { id: string; jobTitle: string; companyName: string } | null;
}): AgentSuggestion[] {
  const own: AgentSuggestion[] = [];

  if (nextInterview) {
    own.push({ label: `Prep for my ${nextInterview.companyName} interview`, prompt: interviewPrepPrompt(nextInterview) });
  }
  const chase = attention.find((a) => a.reason.kind === "follow_up" || a.reason.kind === "no_reply");
  if (chase) {
    own.push({ label: `Draft a follow-up to ${chase.item.companyName}`, prompt: followUpPrompt(chase.item) });
  }
  if (topJob) {
    own.push({
      label: `Tailor my resume for ${topJob.companyName}`,
      prompt: tailorResumePrompt({ id: topJob.id, allJobsId: topJob.id, jobTitle: topJob.jobTitle, companyName: topJob.companyName }),
    });
  }

  const starters = APPLICANT_STARTERS.map((prompt) => ({ label: prompt, prompt }));
  return [...own, ...starters].slice(0, MAX_SUGGESTIONS);
}
