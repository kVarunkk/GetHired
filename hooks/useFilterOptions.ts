import useSWR from "swr";
import { useMemo } from "react";
import { fetcher, ONE_DAY_MS, commonIndustries } from "@/utils/utils";

export interface FilterOptions {
  uniqueCompanies: { company_name: string }[];
  uniqueLocations: { location: string }[];
  uniqueJobRoles: { job_role: string }[];
  uniqueIndustryPreferences: { industry_preference: string }[];
  uniqueSkills: { skill: string }[];
  uniqueWorkStylePreferences: { work_style_preference: string }[];
  uniqueIndustries: { industry: string }[];
  loading: boolean;
  error: any;
}

export function useFilterOptions(
  currentPage: "jobs" | "profiles" | "companies",
): FilterOptions {
  const {
    data: filterData,
    error: filterError,
    isLoading: filterLoading,
  } = useSWR(`/api/${currentPage}/filters`, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: ONE_DAY_MS,
    revalidateIfStale: false,
  });

  const uniqueCompanies = useMemo(
    () => filterData?.companies || [],
    [filterData?.companies],
  );
  const uniqueLocations = useMemo(
    () => filterData?.uniqueLocations || [],
    [filterData?.uniqueLocations],
  );
  const uniqueJobRoles = useMemo(
    () => filterData?.uniqueJobRoles || [],
    [filterData?.uniqueJobRoles],
  );
  const uniqueIndustryPreferences = useMemo(
    () => filterData?.uniqueIndustryPreferences || [],
    [filterData?.uniqueIndustryPreferences],
  );
  const uniqueSkills = useMemo(
    () => filterData?.uniqueSkills || [],
    [filterData?.uniqueSkills],
  );
  const uniqueWorkStylePreferences = useMemo(
    () => filterData?.uniqueWorkStylePreferences || [],
    [filterData?.uniqueWorkStylePreferences],
  );

  const uniqueIndustries = useMemo(
    () => commonIndustries.map((each) => ({ industry: each })),
    [],
  );

  return {
    uniqueCompanies,
    uniqueLocations,
    uniqueJobRoles,
    uniqueIndustryPreferences,
    uniqueSkills,
    uniqueWorkStylePreferences,
    uniqueIndustries,
    loading: filterLoading,
    error: filterError,
  };
}
