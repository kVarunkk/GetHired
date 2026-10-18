"use client";

import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { PlatformGrid } from "./PlatformGrid";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
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

export function HowWeHelp({ jobCount }: { jobCount: number }) {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");

  // The cards' visuals are built-in previews (no theme-specific images), so they
  // render straight away instead of waiting for the client to mount.
  const memoizedFeatures = useMemo(
    () => [
      {
        name: isHirePage
          ? "Personalized Candidate Discovery"
          : "Finds jobs that fit you",
        description: isHirePage
          ? "Stop wasting time on irrelevant job seeker profiles. Our advanced AI learns your preferences to bring you candidates you'll actually love"
          : "Describe the role in plain English. It ranks the best matches for you.",
        href: isHirePage ? "/company/profiles" : "/agent",
        cta: isHirePage ? "Find your Dream Candidate" : "Ask the agent",
        background: isHirePage ? (
          <HireCandidatesPreview />
        ) : (
          <AgentJobSearchPreview />
        ),
        className: "lg:row-start-2 lg:row-end-3 lg:col-start-2 lg:col-end-3",
      },
      {
        name: isHirePage
          ? "Effortless Applicant Tracking"
          : "Keeps track of your applications",
        description: isHirePage
          ? "Manage all your applications in one place"
          : "Your applications, saved jobs and interviews, tracked in one chat.",
        href: isHirePage ? "/company" : "/agent",
        cta: isHirePage ? "Learn more" : "Start tracking",
        background: isHirePage ? (
          <HireApplicantsPreview />
        ) : (
          <AgentApplicationsPreview />
        ),
        className: "lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-2",
      },
      {
        name: isHirePage ? "AI Job Composer" : "Searches every major job board",
        description: isHirePage
          ? "Create high-converting roles instantly. Our templates mandate key data to ensure clarity and attract only the most qualified, focused talent."
          : `Over ${jobCount.toLocaleString("en-US")} listings from Greenhouse, Workday, Ashby and more.`,
        href: isHirePage ? "/company" : "/jobs",
        cta: isHirePage ? "Learn more" : "Browse jobs",
        background: isHirePage ? <HireComposerPreview /> : <PlatformGrid />,
        className: "lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3",
      },
      {
        name: isHirePage ? "Direct Talent Pipeline" : "Gets you ready to apply",
        description: isHirePage
          ? "Manage your open roles and review pre-screened talent in one dashboard."
          : "Resume reviews against the job, plus AI mock interviews with feedback.",
        href: isHirePage ? "/company" : "/agent",
        cta: isHirePage ? "Learn more" : "Prepare with the agent",
        background: isHirePage ? <HirePipelinePreview /> : <AgentPrepPreview />,
        className: "lg:col-start-1 lg:col-end-3 lg:row-start-3 lg:row-end-4",
      },
    ],
    [isHirePage, jobCount],
  );

  return (
    <div
      id="howwehelp"
      className="flex flex-col  items-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80"
    >
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          {isHirePage
            ? "How We Revolutionize Your Hiring"
            : "Your AI job-search agent"}
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isHirePage
            ? "Connecting you with exceptional, pre-qualified talent with speed and unmatched precision."
            : "One chat for the whole search: finding roles, fixing your resume, practising interviews and keeping track of it all."}
        </p>
      </div>
      <BentoGrid className="lg:grid-rows-3 lg:grid-cols-2">
        {memoizedFeatures.map((feature) => (
          <BentoCard key={feature.name} {...feature} />
        ))}
      </BentoGrid>
    </div>
  );
}
