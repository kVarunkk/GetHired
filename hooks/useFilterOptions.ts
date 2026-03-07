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

/**
 * Fetches filter metadata for a given page and normalizes the arrays.
 * Also pulls location list for the component.
 */
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
  });

  const {
    data: countriesData,
    error: countriesError,
    isLoading: countriesLoading,
  } = useSWR(`/api/locations?filterComponent=true`, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: ONE_DAY_MS,
  });

  const uniqueCompanies = useMemo(
    () => (filterData?.companies && !filterError ? filterData.companies : []),
    [filterData, filterError],
  );

  const uniqueLocations = useMemo(
    () => (filterData?.locations && !filterError ? filterData.locations : []),
    [filterData, filterError],
  );

  const uniqueJobRoles = useMemo(
    () =>
      filterData?.uniqueJobRoles && !filterError
        ? filterData.uniqueJobRoles
        : [],
    [filterData, filterError],
  );

  const uniqueIndustryPreferences = useMemo(
    () =>
      filterData?.uniqueIndustryPreferences && !filterError
        ? filterData.uniqueIndustryPreferences
        : [],
    [filterData, filterError],
  );

  const uniqueSkills = useMemo(
    () =>
      filterData?.uniqueSkills && !filterError ? filterData.uniqueSkills : [],
    [filterData, filterError],
  );

  const uniqueWorkStylePreferences = useMemo(
    () =>
      filterData?.uniqueWorkStylePreferences && !filterError
        ? filterData.uniqueWorkStylePreferences
        : [],
    [filterData, filterError],
  );

  const countries = useMemo(
    () => (countriesData && !countriesError ? countriesData.data : []),
    [countriesData, countriesError],
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
    countries,
    uniqueIndustries,
    loading: filterLoading || countriesLoading,
    error: filterError || countriesError,
  };
}
