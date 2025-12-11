"use client";

import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import { ICompanyInfo, IFormData } from "@/lib/types";
import JobsComponent from "@/components/JobsComponent";

export default function ProfilesList({
  // uniqueLocations,
  user,
  // uniqueJobRoles,
  // uniqueIndustryPreferences,
  // uniqueWorkStylePreferences,
  // uniqueSkills,
  companyData,
  onboardingComplete,
  initialProfiles,
  totalCount,
}: {
  // uniqueLocations: { location: string }[];
  user: User | null;
  // uniqueJobRoles: { job_role: string }[];
  // uniqueIndustryPreferences: { industry_preference: string }[];
  // uniqueWorkStylePreferences: { work_style_preference: string }[];
  // uniqueSkills: { skill: string }[];
  companyData: ICompanyInfo;
  onboardingComplete: boolean;
  initialProfiles: IFormData[];
  totalCount: number;
}) {
  const [dataState, setData] = useState<IFormData[] | never[] | null>();
  const [countState, setCount] = useState<number | null>();
  const [loading, setLoading] = useState(true);

  const searchParameters = useSearchParams();

  useEffect(() => {
    (async () => {
      setCount(initialProfiles.length);
      setData(initialProfiles);
      setLoading(false);
    })();
  }, [initialProfiles]);

  if (loading) {
    return (
      <div className="flex items-center justify-center text-muted-foreground mt-36">
        Loading...
      </div>
    );
  } else
    return (
      <JobsComponent
        initialJobs={dataState || []}
        // totalJobs={countState || 0}
        user={user}
        // uniqueLocations={uniqueLocations}
        // uniqueJobRoles={uniqueJobRoles}
        // uniqueIndustryPreferences={uniqueIndustryPreferences}
        // uniqueWorkStylePreferences={uniqueWorkStylePreferences}
        // uniqueSkills={uniqueSkills}
        isCompanyUser={true}
        current_page={"profiles"}
        companyId={companyData.id}
        isOnboardingComplete={onboardingComplete}
        isAllJobsTab={!searchParameters.get("tab")}
        isAppliedJobsTabActive={false}
        totalCount={totalCount}
      />
    );
  // }
}
