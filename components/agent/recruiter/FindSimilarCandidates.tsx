"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agentPromptHref, COMPANY_AGENT_PATH, savePendingPrompt } from "@/helpers/agent/prompt-draft";

/** Similarity is job-related only: roles, skills and experience (RA-SEC-004). */
export const similarCandidatesPrompt = (candidateId: string) =>
  `Find candidates with similar roles, skills and experience to candidate ${candidateId}.`;

/** "Find similar candidates" on a candidate's profile (RA-REQ-009). */
export default function FindSimilarCandidates({ candidateId }: { candidateId: string }) {
  const prompt = similarCandidatesPrompt(candidateId);
  return (
    <Button asChild variant="outline" size="sm">
      <Link
        href={agentPromptHref(prompt, COMPANY_AGENT_PATH)}
        onClick={() => savePendingPrompt(prompt)}
        aria-label="Find similar candidates"
      >
        <Users className="h-4 w-4" />
        <span className="hidden sm:inline">Find similar candidates</span>
      </Link>
    </Button>
  );
}
