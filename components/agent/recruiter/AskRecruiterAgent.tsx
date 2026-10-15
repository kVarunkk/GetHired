"use client";

import { AGENT_ROLE_UI } from "../roles";
import AskAgentBox from "./AskAgentBox";

/** The company dashboard's composer for the recruiter agent (RA-REQ-009). */
export default function AskRecruiterAgent() {
  return (
    <AskAgentBox
      title="Ask your hiring assistant"
      placeholder="Find 5 backend engineers in Bangalore who know Go…"
      suggestions={AGENT_ROLE_UI.company.starters.map((prompt) => ({ label: prompt, prompt }))}
    />
  );
}
