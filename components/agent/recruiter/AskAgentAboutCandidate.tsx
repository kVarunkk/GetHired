"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

// The candidate profile page's entry point to the recruiter agent. The
// candidate's id goes in each prompt so the agent can read the profile with
// getCandidateProfile. The page passes `can(...)` / `canAny(...)` booleans
// that hide the chips whose tools the viewer's permissions don't give the agent.

type Candidate = { id: string; name: string | null };

type Allowed = {
  canSearch: boolean;
  canManageLists: boolean;
  canSendOutreach: boolean;
};

const when = (allowed: boolean, suggestion: AgentSuggestion) => (allowed ? [suggestion] : []);

const candidateRef = (c: Candidate) => `${c.name ?? "this candidate"} (candidate ${c.id})`;

export function candidateQuestionPrompt(c: Candidate, question: string) {
  return `About ${candidateRef(c)}: ${question.trim()}`;
}

export function candidateSuggestions(c: Candidate, p: Allowed): AgentSuggestion[] {
  const ref = candidateRef(c);
  return [
    // getCandidateProfile (its matches to the company's jobs)
    { label: "Which jobs fit them?", prompt: `Which of my jobs is ${ref} the best fit for, and why?` },
    // searchCandidates
    ...when(p.canSearch, { label: "Find similar candidates", prompt: similarCandidatesPrompt(c.id) }),
    // addToTalentList
    ...when(p.canManageLists, {
      label: "Add to a talent list",
      prompt: `Add ${ref} to one of my talent lists. Show me my lists and ask me which one.`,
    }),
    // sendOutreach (asks before sending)
    ...when(p.canSendOutreach, {
      label: "Draft outreach",
      prompt: `Draft an outreach message to ${ref} for the job they fit best. Show it to me before sending.`,
    }),
  ];
}

export default function AskAgentAboutCandidate({ candidate, ...allowed }: { candidate: Candidate } & Allowed) {
  return (
    <AskAgentBox
      title="Ask the agent about this candidate"
      placeholder="How does their experience compare to my last hire?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={candidateSuggestions(candidate, allowed)}
      toPrompt={(question) => candidateQuestionPrompt(candidate, question)}
    />
  );
}
