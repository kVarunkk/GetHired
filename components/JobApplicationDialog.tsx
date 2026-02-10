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
import { useEffect, useState } from "react";
import { IJob, TApplicationStatus } from "@/lib/types";
import { User } from "@supabase/supabase-js";
import PropagationStopper from "./StopPropagation";
import InfoTooltip from "./InfoTooltip";
import JobApplicationForm from "./JobApplicationForm";
import Link from "next/link";

export default function JobApplicationDialog({
  jobPost,
  user,
  isAppliedJobsTabActive,
}: {
  jobPost: IJob;
  user: User | null;
  isAppliedJobsTabActive: boolean;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [applicationStatus, setApplicationStatus] =
    useState<TApplicationStatus | null>(null);

  useEffect(() => {
    if (isAppliedJobsTabActive) {
      setApplicationStatus(jobPost?.applications?.[0]?.status ?? null);
    } else {
      if (jobPost.job_postings && jobPost.job_postings.length > 0) {
        const applicationForUser = jobPost.job_postings[0]?.applications?.find(
          (each) => each.applicant_user_id === user?.id
        );
        setApplicationStatus(applicationForUser?.status ?? null);
      }
    }
  }, [jobPost, user?.id, isAppliedJobsTabActive]);

  return (
    <Dialog
      open={isDialogOpen}
      onOpenChange={(open) => {
        setIsDialogOpen(open);
      }}
    >
      {applicationStatus ? (
        <PropagationStopper>
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                <p>
                  Your current application status is <b>{applicationStatus}</b>.
                  You&apos;ll be notified via email if the status changes.
                </p>
              }
            />
            <Button
              onClick={(e) => e.stopPropagation()}
              className="capitalize"
              disabled={
                applicationStatus !== null || jobPost.status === "inactive"
              }
            >
              {applicationStatus ?? "Easy Apply"}{" "}
              {!applicationStatus && <ArrowRight className=" h-4 w-4" />}
            </Button>
          </div>
        </PropagationStopper>
      ) : (
        <PropagationStopper>
          <DialogTrigger asChild>
            <Button
              className="capitalize"
              disabled={
                applicationStatus !== null || jobPost.status === "inactive"
              }
            >
              {applicationStatus ?? "Easy Apply"}{" "}
              {!applicationStatus && <ArrowRight className=" h-4 w-4" />}
            </Button>
          </DialogTrigger>
        </PropagationStopper>
      )}
      <DialogContent className="max-w-4xl h-screen sm:h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-full">
          {/* Left Panel: Company Info */}
          <div className="flex-[0.4] sm:flex-[0.6] overflow-y-auto p-6 bg-secondary">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">
                Apply for {jobPost.job_name}
              </DialogTitle>
              <DialogDescription>at {jobPost.company_name}</DialogDescription>
            </DialogHeader>
            {/* <Separator className="my-4" /> */}
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
                  {/* <p className="text-sm  whitespace-pre-wrap">
                    {jobPost.description || "No description provided."}
                  </p> */}
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
              {/* You can add more company details here */}
            </div>
          </div>

          {/* Right Panel: Application Form */}
          <div className="flex-1  overflow-y-auto p-6">
            {user && (
              <JobApplicationForm
                jobPost={jobPost}
                user={user}
                onSuccess={() => {
                  setIsDialogOpen(false);
                  setApplicationStatus(
                    "submitted" as TApplicationStatus.SUBMITTED
                  );
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    // </PropagationStopper>
  );
}
