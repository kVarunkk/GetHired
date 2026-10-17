"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import AskAgentBox from "../AskAgentBox";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

// The outreach page's entry point to the recruiter agent. The outreach id goes
// in each prompt so the agent can read it with getOutreach.

type Outreach = {
  id: string;
  subject: string;
  status: OutreachStatus;
  candidateUserId: string;
  candidateName: string | null;
};

const outreachRef = (o: Outreach) =>
  `my outreach "${o.subject}" to ${o.candidateName ?? "a candidate"} (outreach ${o.id})`;

export function outreachQuestionPrompt(o: Outreach, question: string) {
  return `About ${outreachRef(o)}: ${question.trim()}`;
}

export function outreachSuggestions(o: Outreach) {
  const ref = outreachRef(o);
  const similar = { label: "Find similar candidates", prompt: similarCandidatesPrompt(o.candidateUserId) };

  switch (o.status) {
    case "interested":
      return [
        { label: "Plan next steps", prompt: `The candidate answered Interested to ${ref}. What should I do next?` },
        similar,
      ];
    case "sent":
      return [
        { label: "Review the message", prompt: `Read ${ref} and tell me how to make messages like it more likely to get a reply.` },
        similar,
      ];
    default:
      return [
        { label: "What to change", prompt: `Read ${ref} and the answer, and suggest what to change in my next outreach.` },
        similar,
      ];
  }
}

export default function AskAgentAboutOutreach({ outreach }: { outreach: Outreach }) {
  return (
    <AskAgentBox
      title="Ask the agent about this message"
      placeholder="Is this candidate a fit for my other jobs?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={outreachSuggestions(outreach)}
      toPrompt={(question) => outreachQuestionPrompt(outreach, question)}
    />
  );
}
