"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import PageHeader from "@/components/PageHeader";
import AgentHandoff from "@/components/agent/AgentHandoff";
import JobApplicationForm from "@/components/JobApplicationForm";
import ScreeningInviteCard from "@/components/interviews/ScreeningInviteCard";
import ApplyJobSummary from "@/components/apply/ApplyJobSummary";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { applyHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import type { ScreeningInviteSummary } from "@/helpers/interview/screening/my-interviews";
import type { TJobIdPageData } from "@/utils/types/jobs.types";
import { PROFILE_API_KEY } from "@/utils/utils";

type ProfileCache = { profile?: { applications?: unknown[] } } | undefined;

/**
 * AP-REQ-003: the apply page both routes render. The routes load data and
 * decide access (`loadApplyPage`); this shows the form beside the job.
 */
export default function ApplyPage({
  job,
  userId,
  source,
  sourceRef,
  doneHref,
  backLabel = "Back to job",
}: {
  job: TJobIdPageData;
  userId: string;
  source?: "careers_page" | "job_board";
  sourceRef?: string;
  /** The job page, where the button shows the application's status. */
  doneHref: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [invite, setInvite] = useState<ScreeningInviteSummary | null>(null);

  const done = () => router.push(doneHref);

  const onSuccess = (interview?: ScreeningInviteSummary) => {
    // The job page's button reads the profile cache, so add the application first (AP-REQ-035).
    mutate(
      PROFILE_API_KEY,
      (current: ProfileCache) => {
        if (!current) return current;
        const profile = current.profile || {};
        return {
          ...current,
          profile: {
            ...profile,
            applications: [{ all_jobs_id: job.id, status: "submitted" }, ...(profile.applications || [])],
          },
        };
      },
      false,
    );
    if (interview) setInvite(interview);
    else done();
  };

  return (
    <div className="mb-20 flex w-full flex-col gap-6 p-4">
      <PageHeader
        backHref={doneHref}
        backLabel={backLabel}
        eyebrow={`at ${job.company_name}`}
        title={`Apply for ${job.job_name}`}
      />
      <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          {invite ? (
            <ScreeningInviteCard interview={invite} onLater={done} />
          ) : (
            <>
              <AgentHandoff
                label="Or let the agent fill this in and apply"
                placeholder="Anything to add? e.g. use my backend resume…"
                basePath={AGENT_PATH}
                allowEmpty
                toPrompt={(text) =>
                  applyHandoffPrompt(text, { id: job.id, title: job.job_name, company: job.company_name })
                }
              />
              <JobApplicationForm
                jobPost={job}
                userId={userId}
                onSuccess={onSuccess}
                source={source}
                sourceRef={sourceRef}
              />
            </>
          )}
        </div>
        <div className="min-w-0">
          <ApplyJobSummary job={job} />
        </div>
      </div>
    </div>
  );
}
