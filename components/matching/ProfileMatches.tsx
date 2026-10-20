"use client";

import { useState } from "react";
import Link from "next/link";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import MatchScoreBadge from "@/components/matching/MatchScoreBadge";
import MatchExplanationCard from "@/components/matching/MatchExplanationCard";
import type { MatchExplanation } from "@/helpers/matching/schemas";
import type { CandidateMatch } from "@/helpers/matching/candidate-matches";

export type { CandidateMatch };

const HEADING_ID = "profile-matches-heading";

/**
 * Every one of the company's jobs this candidate matches (MT-REQ-004), so a
 * recruiter can compare roles on the profile page. Each row shows the score
 * and summary and expands into "Why this candidate"; several can be open at
 * once. The job in context (`?job_post=`) comes first and starts open.
 */
export default function ProfileMatches({
  candidateId,
  matches,
  expandedJobPostId,
}: {
  candidateId: string;
  /** In display order. */
  matches: CandidateMatch[];
  expandedJobPostId?: string;
}) {
  const [expanded, setExpanded] = useState<string[]>(() =>
    expandedJobPostId ? [expandedJobPostId] : [],
  );
  const [explanations, setExplanations] = useState<Record<string, MatchExplanation | null>>(() =>
    Object.fromEntries(matches.map((m) => [m.jobPostId, m.explanation])),
  );

  if (matches.length === 0) return null;

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h2 id={HEADING_ID} className="text-lg font-semibold tracking-tight">
        Matches for your jobs{" "}
        <span className="text-sm font-medium text-muted-foreground">{matches.length}</span>
      </h2>
      <AccordionPrimitive.Root type="multiple" value={expanded} onValueChange={setExpanded} asChild>
        <ul aria-label="Matches for your jobs" className="divide-y rounded-xl border">
          {matches.map((match) => {
            const explanation = explanations[match.jobPostId];
            return (
              <AccordionPrimitive.Item key={match.jobPostId} value={match.jobPostId} asChild>
                <li className="flex flex-col">
                  <AccordionPrimitive.Header asChild>
                    <div>
                      <AccordionPrimitive.Trigger className="group flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium [overflow-wrap:anywhere]">{match.jobTitle}</span>
                          <span className="line-clamp-1 text-sm text-muted-foreground">
                            {explanation?.summary ?? "No explanation yet"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {match.matchScore === null ? (
                            <span className="text-xs text-muted-foreground">Not scored</span>
                          ) : (
                            <MatchScoreBadge score={match.matchScore} className="whitespace-nowrap" />
                          )}
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        </span>
                      </AccordionPrimitive.Trigger>
                    </div>
                  </AccordionPrimitive.Header>
                  {/* Height animates open and closed; a closed panel unmounts. */}
                  <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                    <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
                      <MatchExplanationCard
                        jobPostId={match.jobPostId}
                        candidateId={candidateId}
                        explanation={explanation}
                        onExplained={(next) =>
                          setExplanations((current) => ({ ...current, [match.jobPostId]: next }))
                        }
                      />
                      <Link
                        href={`/company/job-posts/${match.jobPostId}`}
                        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-brand"
                      >
                        View job
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </AccordionPrimitive.Content>
                </li>
              </AccordionPrimitive.Item>
            );
          })}
        </ul>
      </AccordionPrimitive.Root>
    </section>
  );
}
