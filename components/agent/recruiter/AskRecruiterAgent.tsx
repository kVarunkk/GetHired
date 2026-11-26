"use client";

import { AGENT_ROLE_UI } from "../roles";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

/** The company dashboard's composer for the recruiter agent (RA-REQ-009). */
export default function AskRecruiterAgent({
  suggestions = AGENT_ROLE_UI.company.starters.map((prompt) => ({ label: prompt, prompt })),
}: {
  /** The company's own chips (CD-REQ-013); the role's starters by default. */
  suggestions?: AgentSuggestion[];
}) {
  return (
    <AskAgentBox
      title="Ask your hiring assistant"
      placeholder="Find 5 backend engineers in Bangalore who know Go…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={suggestions}
    />
  );
}
