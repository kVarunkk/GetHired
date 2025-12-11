"use client";

import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import { ICompanyInfo, IFormData } from "@/lib/types";
import JobsComponent from "@/components/JobsComponent";

export default function ProfilesList({
  user,
  companyData,
  onboardingComplete,
  initialProfiles,
  totalCount,
}: {
  user: User | null;

  companyData: ICompanyInfo;
  onboardingComplete: boolean;
  initialProfiles: IFormData[];
  totalCount: number;
}) {
  const [dataState, setData] = useState<IFormData[] | never[] | null>();
  const [loading, setLoading] = useState(true);
  const searchParameters = useSearchParams();

  useEffect(() => {
    (async () => {
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
        user={user}
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
