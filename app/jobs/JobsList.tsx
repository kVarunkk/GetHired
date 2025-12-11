"use client";

import JobsComponent from "@/components/JobsComponent";
import { useSearchParams } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { IJob } from "@/lib/types";

export default function JobsList({
  user,
  isCompanyUser,
  onboardingComplete,
  initialJobs,
  totalCount,
}: {
  user: User | null;
  isCompanyUser: boolean;
  onboardingComplete: boolean;
  initialJobs: IJob[];
  totalCount: number;
}) {
  const searchParameters = useSearchParams();

  return (
    <JobsComponent
      initialJobs={initialJobs || []}
      user={user}
      isCompanyUser={isCompanyUser}
      isOnboardingComplete={onboardingComplete}
      isAllJobsTab={!searchParameters.get("tab")}
      isAppliedJobsTabActive={searchParameters.get("tab") === "applied"}
      totalCount={totalCount}
      current_page="jobs"
    />
  );
}
