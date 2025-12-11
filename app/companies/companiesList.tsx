"use client";

import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import { IFormData } from "@/lib/types";
import JobsComponent from "@/components/JobsComponent";

export default function CompaniesList({
  isCompanyUser,
  user,
  companyId,
  onboardingComplete,
  initialCompanies,
  totalCount,
}: {
  isCompanyUser: boolean;
  user: User | null;
  companyId: string;
  onboardingComplete: boolean;
  initialCompanies: IFormData[];
  totalCount: number;
}) {
  const [dataState, setData] = useState<IFormData[] | never[] | null>();
  const [loading, setLoading] = useState(true);

  const searchParameters = useSearchParams();

  useEffect(() => {
    (async () => {
      setData(initialCompanies);
      setLoading(false);
    })();
  }, [initialCompanies]);

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
        isCompanyUser={isCompanyUser}
        current_page={"companies"}
        companyId={companyId}
        isOnboardingComplete={onboardingComplete}
        isAllJobsTab={!searchParameters.get("tab")}
        isAppliedJobsTabActive={false}
        totalCount={totalCount}
      />
    );
  // }
}
