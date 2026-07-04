"use client";

import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

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
    <Dialog
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
            <DialogTrigger asChild>
              <Button
                onClick={(e) => e.stopPropagation()}
                className="capitalize"
                disabled={
                  applicationStatus !== null || jobPost.status === "inactive"
                }
              >
                Easy Apply <ArrowRight className=" h-4 w-4" />
              </Button>
            </DialogTrigger>
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
      <DialogContent className="max-w-4xl h-screen sm:h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-full">
          {/* left pane */}
          <div className="flex-[0.4] sm:flex-[0.6] overflow-y-auto p-6 bg-secondary">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">
                Apply for {jobPost.job_name}
              </DialogTitle>
              <DialogDescription>at {jobPost.company_name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-5">
              <Card className="shadow-none border">
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
              <Card className="shadow-none border">
                <CardHeader>
                  <CardTitle className="text-lg">Job Details</CardTitle>
                  <CardDescription className="text-sm font-medium">
                    {jobPost.job_type} | {jobPost.locations.join(", ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="font-semibold text-sm">Description</p>
                    <p className="text-sm ">
                      {jobPost.description || "No description provided."}
                    </p>
                  </div>
                  {jobPost.salary_range && (
                    <div>
                      <p className="font-semibold text-sm">Salary Range</p>
                      <p className="text-sm ">{jobPost.salary_range}</p>
                    </div>
                  )}
                  {jobPost.experience && (
                    <div>
                      <p className="font-semibold text-sm">Experience</p>
                      <p className="text-sm ">{jobPost.experience}</p>
                    </div>
                  )}
                  {jobPost.visa_requirement && (
                    <div>
                      <p className="font-semibold text-sm">Visa Requirement</p>
                      <p className="text-sm ">{jobPost.visa_requirement}</p>
                    </div>
                  )}
                  {jobPost.equity_range && (
                    <div>
                      <p className="font-semibold text-sm">Equity</p>
                      <p className="text-sm ">{jobPost.equity_range}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
          {/* right pane */}
          <div className="flex-1  overflow-y-auto p-6">
            {userId && (
              <JobApplicationForm
                jobPost={jobPost}
                userId={userId}
                onSuccess={jobApplicationFormSuccess}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
