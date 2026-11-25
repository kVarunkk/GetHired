"use client";

import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "./AskAgentBox";
import { APPLICANT_STARTERS } from "./roles";

const STARTER_SUGGESTIONS = APPLICANT_STARTERS.map((prompt) => ({ label: prompt, prompt }));

/** The applicant dashboard's composer for the job search agent. `suggestions` defaults to the general starters. */
export default function AskApplicantAgent({ suggestions = STARTER_SUGGESTIONS }: { suggestions?: AgentSuggestion[] }) {
  return (
    <AskAgentBox
      title="Ask your job search assistant"
      placeholder="Find React jobs that match my resume…"
      basePath={AGENT_PATH}
      suggestions={suggestions}
    />
  );
}
