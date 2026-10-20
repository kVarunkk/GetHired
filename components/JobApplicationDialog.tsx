"use client";

import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTrigger,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { useState } from "react";
import { AllJobWithRelations } from "@/utils/types";
import PropagationStopper from "./StopPropagation";
import InfoTooltip from "./InfoTooltip";
import JobApplicationForm from "./JobApplicationForm";
import Link from "next/link";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { mutate } from "swr";
import { PROFILE_API_KEY } from "@/utils/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AgentHandoff from "./agent/AgentHandoff";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { applyHandoffPrompt } from "@/helpers/agent/handoff-prompts";

export default function JobApplicationDialog({
  jobPost,
  userId,
  appliedJob,
  isApplyDialogOpen,
}: {
  jobPost: AllJobWithRelations | TJobIdPageData;
  userId: string | null;
  appliedJob?: {
    all_jobs_id: string;
    status: string;
  };
  isApplyDialogOpen: boolean;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(isApplyDialogOpen);
  const applicationStatus = appliedJob?.status || null;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const jobApplicationFormSuccess = () => {
    handleCloseDialog();

    mutate(
      PROFILE_API_KEY,
      (currentData) => {
        if (!currentData) return currentData;

        const profile = currentData.profile || {};
        const currentApplications = profile.applications || [];

        const newApplicationRecord = {
          all_jobs_id: jobPost.id,
          status: "submitted",
        };

        return {
          ...currentData,
          profile: {
            ...profile,
            applications: [newApplicationRecord, ...currentApplications],
          },
        };
      },
      false,
    );
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("apply");

    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ""}`,
      {
        scroll: false,
      },
    );
  };

  return (
    <ResponsiveDialog
      open={isDialogOpen}
      onOpenChange={(open) => {
        if (!open) handleCloseDialog();
        setIsDialogOpen(open);
      }}
    >
      <PropagationStopper>
        <div className="flex items-center gap-2">
          {applicationStatus ? (
            <Button
              onClick={(e) => e.stopPropagation()}
              className="capitalize"
              disabled={
                applicationStatus !== null || jobPost.status === "inactive"
              }
            >
              {applicationStatus}
            </Button>
          ) : (
            <ResponsiveDialogTrigger asChild>
              <Button
                variant="brand"
                onClick={(e) => e.stopPropagation()}
                className="capitalize"
                disabled={
                  applicationStatus !== null || jobPost.status === "inactive"
                }
              >
                Easy Apply <ArrowRight className=" h-4 w-4" />
              </Button>
            </ResponsiveDialogTrigger>
          )}

          {applicationStatus && (
            <InfoTooltip
              content={
                <p>
                  Your current application status is <b>{applicationStatus}</b>.
                  You&apos;ll be notified via email if the status changes.
                </p>
              }
            />
          )}
        </div>
      </PropagationStopper>
      {/* The panes scroll themselves, so the drawer column gets a fixed height and no padding. */}
      <ResponsiveDialogContent
        className="max-w-4xl h-[85vh] flex flex-col p-0 overflow-hidden"
        drawerClassName="h-[85dvh] gap-0 overflow-hidden p-0"
      >
        <div className="flex flex-col md:flex-row h-full">
          {/* left pane: min-w-0 and overflow-wrap so long links and unbroken text in the JD wrap instead of widening the pane */}
          <div className="min-w-0 flex-[0.4] sm:flex-[0.6] overflow-y-auto overflow-x-hidden p-4 sm:p-6 bg-muted/30 border-b md:border-b-0 md:border-r [overflow-wrap:anywhere]">
            <ResponsiveDialogHeader className="-mt-4 sm:-mt-6">
              <ResponsiveDialogTitle className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                Apply for {jobPost.job_name}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                at {jobPost.company_name}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="space-y-4 mt-5">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Company Profile</CardTitle>
                  {jobPost.company_url && (
                    <CardDescription>
                      <Link
                        href={jobPost.company_url}
                        target="_blank"
                        className="underline underline-offset-[4px] flex items-center gap-1"
                      >
                        Visit Company Page <ExternalLink className="h-4 w-4" />
                      </Link>
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm ">
                    {jobPost.job_postings && jobPost.job_postings.length > 0
                      ? jobPost.job_postings[0].company_info?.description
                      : "No description provided."}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Job Details</CardTitle>
                  <CardDescription className="text-sm font-medium">
                    {jobPost.job_type} | {jobPost.locations.join(", ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Description
                    </p>
                    <p className="text-sm ">
                      {jobPost.description || "No description provided."}
                    </p>
                  </div>
                  {jobPost.salary_range && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Salary Range
                      </p>
                      <p className="text-sm ">{jobPost.salary_range}</p>
                    </div>
                  )}
                  {jobPost.experience && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Experience
                      </p>
                      <p className="text-sm ">{jobPost.experience}</p>
                    </div>
                  )}
                  {jobPost.visa_requirement && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Visa Requirement
                      </p>
                      <p className="text-sm ">{jobPost.visa_requirement}</p>
                    </div>
                  )}
                  {jobPost.equity_range && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Equity
                      </p>
                      <p className="text-sm ">{jobPost.equity_range}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
          {/* right pane */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {userId && (
              <JobApplicationForm
                jobPost={jobPost}
                userId={userId}
                onSuccess={jobApplicationFormSuccess}
                belowSteps={
                  <AgentHandoff
                    label="Or let the agent fill this in and apply"
                    placeholder="Anything to add? e.g. use my backend resume…"
                    basePath={AGENT_PATH}
                    allowEmpty
                    toPrompt={(text) =>
                      applyHandoffPrompt(text, {
                        id: jobPost.id,
                        title: jobPost.job_name,
                        company: jobPost.company_name,
                      })
                    }
                    onHandoff={() => setIsDialogOpen(false)}
                  />
                }
              />
            )}
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
