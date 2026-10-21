"use client";

import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { PlatformGrid } from "./PlatformGrid";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  agentPromptHref,
  COMPANY_AGENT_PATH,
  savePendingPrompt,
} from "@/helpers/agent/prompt-draft";
import {
  AgentApplicationsPreview,
  AgentJobSearchPreview,
  AgentPrepPreview,
} from "./AgentPreviews";
import {
  HireApplicantsPreview,
  HireCandidatesPreview,
  HireComposerPreview,
  HirePipelinePreview,
} from "./HirePreviews";
import { howWeHelpCopy } from "@/helpers/marketing/content";

// Each card opens the agent (the recruiter agent on /hire) with a prompt for
// what the card offers. The prompt is also saved, so it survives a detour
// through login.
const JOB_SEARCH_PROMPT = "Find jobs that match my profile";
const TRACKING_PROMPT = "Show my applications, saved jobs and upcoming interviews";
const BOARD_SEARCH_PROMPT = "Search for remote software engineer jobs posted this week";
const PREP_PROMPT = "Review my resume and set up a mock interview";

const CANDIDATE_SEARCH_PROMPT = "Find candidates who match my open jobs";
const APPLICANTS_PROMPT = "Show me the newest applicants across my jobs";
const JOB_POST_PROMPT = "Draft a job post for a senior backend engineer";
const PIPELINE_PROMPT = "Summarise my hiring funnel and who's waiting for review";

function agentCta(prompt: string, base?: string) {
  return { href: agentPromptHref(prompt, base), onCtaClick: () => savePendingPrompt(prompt) };
}

function hireCta(prompt: string) {
  return agentCta(prompt, COMPANY_AGENT_PATH);
}

export function HowWeHelp({ jobCount }: { jobCount: number }) {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");

  // The cards' visuals are built-in previews (no theme-specific images), so they
  // render straight away instead of waiting for the client to mount.
  const section = useMemo(() => {
    const copy = howWeHelpCopy(isHirePage ? "hire" : "applicant", jobCount);
    // Card order matches the copy's features.
    const cards = [
      {
        ...(isHirePage ? hireCta(CANDIDATE_SEARCH_PROMPT) : agentCta(JOB_SEARCH_PROMPT)),
        cta: isHirePage ? "Find your Dream Candidate" : "Ask the agent",
        background: isHirePage ? (
          <HireCandidatesPreview />
        ) : (
          <AgentJobSearchPreview />
        ),
        className: "lg:row-start-2 lg:row-end-3 lg:col-start-2 lg:col-end-3",
      },
      {
        ...(isHirePage ? hireCta(APPLICANTS_PROMPT) : agentCta(TRACKING_PROMPT)),
        cta: isHirePage ? "Review applicants" : "Start tracking",
        background: isHirePage ? (
          <HireApplicantsPreview />
        ) : (
          <AgentApplicationsPreview />
        ),
        className: "lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-2",
      },
      {
        ...(isHirePage ? hireCta(JOB_POST_PROMPT) : agentCta(BOARD_SEARCH_PROMPT)),
        cta: isHirePage ? "Draft a job post" : "Search with the agent",
        background: isHirePage ? <HireComposerPreview /> : <PlatformGrid />,
        className: "lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3",
      },
      {
        ...(isHirePage ? hireCta(PIPELINE_PROMPT) : agentCta(PREP_PROMPT)),
        cta: isHirePage ? "Check your pipeline" : "Prepare with the agent",
        background: isHirePage ? <HirePipelinePreview /> : <AgentPrepPreview />,
        className: "lg:col-start-1 lg:col-end-3 lg:row-start-3 lg:row-end-4",
      },
    ];
    return {
      heading: copy.heading,
      subheading: copy.subheading,
      features: copy.features.map((feature, i) => ({ ...feature, ...cards[i] })),
    };
  }, [isHirePage, jobCount]);

  return (
    <div
      id="howwehelp"
      className="flex flex-col  items-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80"
    >
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          {section.heading}
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {section.subheading}
        </p>
      </div>
      <BentoGrid className="lg:grid-rows-3 lg:grid-cols-2">
        {section.features.map((feature) => (
          <BentoCard key={feature.name} {...feature} />
        ))}
      </BentoGrid>
    </div>
  );
}
