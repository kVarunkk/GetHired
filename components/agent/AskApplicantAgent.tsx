"use client";

import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox from "./AskAgentBox";
import { APPLICANT_STARTERS } from "./roles";

/** The applicant dashboard's composer for the job search agent. */
export default function AskApplicantAgent() {
  return (
    <AskAgentBox
      title="Ask your job search assistant"
      placeholder="Find React jobs that match my resume…"
      basePath={AGENT_PATH}
      suggestions={APPLICANT_STARTERS.map((prompt) => ({ label: prompt, prompt }))}
    />
  );
}
