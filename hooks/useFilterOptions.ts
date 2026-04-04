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
  countries: { location: string }[];
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
    // prevents fetch on re mount
    revalidateIfStale: false,
  });

  const {
    data: countriesData,
    error: countriesError,
    isLoading: countriesLoading,
  } = useSWR(`/api/locations?filterComponent=true`, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: ONE_DAY_MS,
    revalidateIfStale: false,
  });

  const countries = useMemo(() => countriesData?.data || [], [countriesData]);

  const uniqueIndustries = useMemo(
    () => commonIndustries.map((each) => ({ industry: each })),
    [],
  );

  return {
    uniqueCompanies: filterData?.companies || [],
    uniqueLocations: filterData?.uniqueLocations || [],
    uniqueJobRoles: filterData?.uniqueJobRoles || [],
    uniqueIndustryPreferences: filterData?.uniqueIndustryPreferences || [],
    uniqueSkills: filterData?.uniqueSkills || [],
    uniqueWorkStylePreferences: filterData?.uniqueWorkStylePreferences || [],
    countries,
    uniqueIndustries,
    loading: filterLoading || countriesLoading,
    error: filterError || countriesError,
  };
}
