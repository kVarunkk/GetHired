"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

// The application page's entry point to the recruiter agent. The application,
// candidate and job ids go in each prompt so the agent can pass them to its
// tools. The page passes `can(..., jobId)` booleans that hide the chips whose
// tools the viewer's permissions don't give the agent.

type Application = {
  id: string;
  candidateId: string | null;
  candidateName: string | null;
  jobPostId: string | null;
  jobTitle: string | null;
};

type Allowed = {
  canView: boolean;
  canMatch: boolean;
  canViewNotes: boolean;
  canMove: boolean;
  canSearch: boolean;
};

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const applicationRef = (a: Application) =>
  `${a.candidateName ?? "the applicant"}'s application${a.jobTitle ? ` to "${a.jobTitle}"` : ""} (application ${a.id})`;

export function applicationQuestionPrompt(a: Application, question: string) {
  return `About ${applicationRef(a)}: ${question.trim()}`;
}

export function applicationSuggestions(a: Application, p: Allowed): AgentSuggestion[] {
  const ref = applicationRef(a);
  return [
    // getApplication
    ...when(p.canView, {
      label: "Summarise this applicant",
      prompt: `Summarise ${ref}: their background, their answers and the screening.`,
    }),
    // explainMatch
    ...when(p.canMatch && a.candidateId !== null && a.jobPostId !== null, {
      label: "Explain the fit",
      prompt: `Explain how candidate ${a.candidateId} fits job post ${a.jobPostId}: strengths and gaps.`,
    }),
    // listNotes
    ...when(p.canViewNotes, {
      label: "Summarise the notes",
      prompt: `Summarise my team's notes on ${ref}.`,
    }),
    // moveApplications (asks before moving)
    ...when(p.canMove, {
      label: "Move to the next stage",
      prompt: `Move ${ref} to the next stage of the pipeline. Show me before moving.`,
    }),
    // searchCandidates
    ...when(p.canSearch && a.candidateId !== null, {
      label: "Find similar candidates",
      prompt: similarCandidatesPrompt(a.candidateId ?? ""),
    }),
  ];
}

export default function AskAgentAboutApplication({
  application,
  ...allowed
}: { application: Application } & Allowed) {
  return (
    <AskAgentBox
      title="Ask the agent about this applicant"
      placeholder="Should I interview them? What should I ask?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={applicationSuggestions(application, allowed)}
      toPrompt={(question) => applicationQuestionPrompt(application, question)}
    />
  );
}
