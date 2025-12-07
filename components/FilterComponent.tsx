"use client";

import { useSearchParams, useRouter } from "next/navigation";
import {
  FormEvent,
  useState,
  ChangeEvent,
  useEffect,
  useTransition,
  SetStateAction,
  Dispatch,
  useCallback,
  useMemo,
} from "react";
import MultiKeywordSelect, { GenericFormData } from "./MultiKeywordSelect";
import MultiKeywordSelectInput from "./MultiKeywordSelectInput";
import InputFilter from "./InputFilterComponent";
import { TApplicationStatus } from "@/lib/types";
import { useProgress } from "react-transition-progress";
import FilterActions from "./FilterActions";
import useSWR from "swr";
import { commonIndustries, fetcher } from "@/lib/utils";

type FilterConfig = {
  name: keyof FiltersState;
  label: string;
  type: "text" | "number" | "multi-select" | "multi-select-input"; // Removed 'select' type
  placeholder?: string;
  options?: { value: string; label: string }[]; // Options for multi-select (for availableItems prop)
  isVirtualized?: boolean;
  hidden?: boolean;
};

// Define the type for the component's state
export type FiltersState = {
  jobType: string[];
  location: string[];
  visaRequirement: string[];
  minSalary: string;
  minExperience: string;
  platform: string[];
  companyName: string[];
  jobTitleKeywords: string[];
  jobRole: string[];
  industryPreference: string[];
  workStylePreference: string[];
  skills: string[];
  maxSalary?: string;
  applicationStatus: TApplicationStatus;
  industry?: string[];
  name?: string[];
  size?: string[];
};

export default function FilterComponent({
  setOpenSheet,

  currentPage,
  onboardingComplete,
}: {
  setOpenSheet?: Dispatch<SetStateAction<boolean>>;

  currentPage: "jobs" | "profiles" | "companies";
  onboardingComplete: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startProgress = useProgress();
  const [isPending, startTransition] = useTransition();

  const toOptions = (list?: { location: string }[]) =>
    list?.map((each) => ({ value: each.location, label: each.location })) || [];

  const { data: filterData, error: filterError } = useSWR(
    `/api/${currentPage}/filters`,
    fetcher
  );

  const uniqueCompanies: { company_name: string }[] = useMemo(
    () => (filterData?.companies && !filterError ? filterData.companies : []),
    [filterData, filterError]
  );

  const uniqueLocations: { location: string }[] = useMemo(
    () => (filterData?.locations && !filterError ? filterData.locations : []),
    [filterData, filterError]
  );

  const uniqueJobRoles: { job_role: string }[] = useMemo(
    () =>
      filterData?.uniqueJobRoles && !filterError
        ? filterData.uniqueJobRoles
        : [],
    [filterData, filterError]
  );

  const uniqueIndustryPreferences: { industry_preference: string }[] = useMemo(
    () =>
      filterData?.uniqueIndustryPreferences && !filterError
        ? filterData.uniqueIndustryPreferences
        : [],
    [filterData, filterError]
  );

  const uniqueSkills: { skill: string }[] = useMemo(
    () =>
      filterData?.uniqueSkills && !filterError ? filterData.uniqueSkills : [],
    [filterData, filterError]
  );

  const uniqueWorkStylePreferences: { work_style_preference: string }[] =
    useMemo(
      () =>
        filterData?.uniqueWorkStylePreferences && !filterError
          ? filterData.uniqueWorkStylePreferences
          : [],
      [filterData, filterError]
    );
  const { data: countriesData, error: countriesError } = useSWR(
    `/api/locations?filterComponent=true`,
    fetcher
  );
  const countries: { location: string }[] = useMemo(
    () => (countriesData && !countriesError ? countriesData.data : []),
    [countriesData, countriesError]
  );

  // Handle the static industry list
  const uniqueIndustries = useMemo(
    () => commonIndustries.map((each) => ({ industry: each })),
    [commonIndustries] // Assuming commonIndustries is a stable constant
  );

  const FILTER_CONFIG: FilterConfig[] = useMemo(() => {
    let config: FilterConfig[] = [];
    switch (currentPage) {
      case "jobs":
        config = [
          {
            name: "jobType",
            label: "Job Type",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the type of Job",
            options: [
              { value: "Fulltime", label: "Full Time" },
              { value: "Intern", label: "Internship" },
              { value: "Contract", label: "Contract" },
              // 'all' is handled by the absence of the parameter in the URL
            ],
          },
          {
            name: "jobTitleKeywords",
            label: "Job Title Keywords",
            type: "multi-select-input", // Use multi-select for this
            placeholder: "Type or select from dropdown",
            options: [
              // Provide a list of common job title keywords for the dropdown
              // You can import this from a constants file if you have one
              { value: "Engineer", label: "Engineer" },
              { value: "Developer", label: "Developer" },
              { value: "Manager", label: "Manager" },
              { value: "Analyst", label: "Analyst" },
              { value: "Lead", label: "Lead" },
              { value: "Senior", label: "Senior" },
              { value: "Junior", label: "Junior" },
              { value: "Director", label: "Director" },
              { value: "Architect", label: "Architect" },
              { value: "Specialist", label: "Specialist" },
              // ... add more common keywords as needed
            ],
          },
          {
            name: "location",
            label: "Location",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the location of Job",
            options: countries ? toOptions(countries) : [],

            isVirtualized: true,
          },
          {
            name: "visaRequirement",
            label: "Visa Requirement",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Visa configuration",

            options: [
              {
                value: "US Citizenship/Visa Not Required",
                label: "US Citizenship/Visa Not Required",
              },
              { value: "Will Sponsor", label: "Will Sponsor" },
              { value: "US Citizen/Visa Only", label: "US Citizen/Visa Only" },
            ],
          },

          {
            name: "companyName",
            label: "Company",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the company",
            options: uniqueCompanies?.map((each) => ({
              value: each.company_name,
              label: each.company_name,
            })),
            isVirtualized: true,
          },
          {
            name: "platform",
            label: "Platform",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the platform",

            options: [
              { value: "remoteok", label: "Remote Ok" },
              { value: "uplers", label: "Uplers" },
              { value: "ycombinator", label: "YCombinator" },
              { value: "wellfound", label: "Wellfound" },
              { value: "gethired", label: "GetHired" },
            ],
          },
          {
            name: "applicationStatus",
            label: "Application Status",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the status",
            options: Object.keys(TApplicationStatus).map((each) => ({
              label: each,
              value:
                TApplicationStatus[each as keyof typeof TApplicationStatus],
            })),
            hidden: !onboardingComplete,
          },

          {
            name: "minSalary",
            label: "Minimum Salary",
            type: "number",
            placeholder: "e.g., 80000",
          },
          {
            name: "minExperience",
            label: "Minimum Experience (years)",
            type: "number",
            placeholder: "e.g., 2",
          },
        ];
        break;
      case "profiles":
        config = [
          {
            name: "jobType",
            label: "Job Type",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the type of Job",
            options: [
              { value: "Fulltime", label: "Full Time" },
              { value: "Intern", label: "Internship" },
              { value: "Contract", label: "Contract" },
              // 'all' is handled by the absence of the parameter in the URL
            ],
          },
          {
            name: "jobRole",
            label: "Job Role",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Job Role",
            options: uniqueJobRoles?.map((each) => ({
              value: each.job_role,
              label: each.job_role,
            })),
          },
          {
            name: "industryPreference",
            label: "Industry Preference",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Industry Preference",
            options: uniqueIndustryPreferences?.map((each) => ({
              value: each.industry_preference,
              label: each.industry_preference,
            })),
          },
          {
            name: "workStylePreference",
            label: "Work Style Preference",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Work Style Preference",
            options: uniqueWorkStylePreferences?.map((each) => ({
              value: each.work_style_preference,
              label: each.work_style_preference,
            })),
          },
          {
            name: "skills",
            label: "Skills",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Skills",
            options: uniqueSkills?.map((each) => ({
              value: each.skill,
              label: each.skill,
            })),
          },
          {
            name: "location",
            label: "Location",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the location of Job",

            options: uniqueLocations?.map((each) => ({
              value: each.location,
              label: each.location,
            })),
          },

          {
            name: "maxSalary",
            label: "Maximum Salary",
            type: "number",
            placeholder: "e.g., 80000",
          },
          {
            name: "minExperience",
            label: "Minimum Experience (years)",
            type: "number",
            placeholder: "e.g., 2",
          },
        ];
        break;
      case "companies":
        config = [
          {
            name: "name",
            label: "Company",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Company",
            options: uniqueCompanies?.map((each) => ({
              value: each.company_name,
              label: each.company_name,
            })),
          },
          {
            name: "location",
            label: "Location",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the location of Company",
            options: uniqueLocations?.map((each) => ({
              value: each.location,
              label: each.location,
            })),
            isVirtualized: true,
          },
          {
            name: "industry",
            label: "Industry",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Industry type",
            options: uniqueIndustries?.map((each) => ({
              value: each.industry,
              label: each.industry,
            })),
            isVirtualized: true,
          },
          {
            name: "size",
            label: "Size",
            type: "multi-select", // Changed to multi-select
            placeholder: "Select the Size",
            options: [
              "1-10",
              "11-50",
              "51-200",
              "201-500",
              "501-1000",
              "1000+",
            ].map((each) => ({
              value: each,
              label: each,
            })),
            isVirtualized: false,
          },
        ];
        break;
    }
    return config;
  }, [
    currentPage,
    onboardingComplete,
    uniqueCompanies,
    uniqueIndustries,
    uniqueIndustryPreferences,
    uniqueJobRoles,
    uniqueLocations,
    uniqueSkills,
    uniqueWorkStylePreferences,
    countries,
  ]);

  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const tab = searchParams.get("tab");

  const getInitialState = useCallback(
    (config: FilterConfig[]): FiltersState => {
      const initialState: Partial<FiltersState> = {};
      config.forEach((filter) => {
        const paramValue = searchParams.get(filter.name);
        if (
          filter.type === "multi-select" ||
          filter.type === "multi-select-input"
        ) {
          (initialState[filter.name] as string[]) = paramValue
            ? paramValue
                .split("|")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
        } else {
          (initialState[filter.name] as string) = paramValue || "";
        }
      });
      return initialState as FiltersState;
    },
    [searchParams]
  );

  const [filters, setFilters] = useState<FiltersState>(
    () => getInitialState(FILTER_CONFIG) // Use the memoized config to initialize
  );
  useEffect(() => {
    // If the currentPage or searchParams change, re-run initialization
    setFilters(getInitialState(FILTER_CONFIG));
  }, [getInitialState]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;
      setFilters((prevFilters) => ({
        ...prevFilters,
        [name as keyof FiltersState]: value,
      }));
    },
    [setFilters]
  );

  const handleMultiKeywordSelectChange = useCallback(
    (name: keyof GenericFormData, keywords: string[]) => {
      setFilters((prevFilters) => ({
        ...prevFilters,
        [name]: keywords,
      }));
    },
    [setFilters]
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();

    if (tab) {
      params.set("tab", tab);
    }

    for (const [key, value] of Object.entries(filters)) {
      const filterConfig = FILTER_CONFIG.find((config) => config.name === key);

      if (key === "applicationStatus" && value && value.length > 0)
        params.set("tab", "applied");

      if (
        filterConfig?.type === "multi-select" ||
        filterConfig?.type === "multi-select-input"
      ) {
        if (Array.isArray(value) && value.length > 0) {
          // params.set(key, value.join(","));
          params.set(key, value.join("|"));
        }
      } else {
        if (value && value !== "") {
          params.set(key, value as string);
        }
      }
    }

    if (sortBy) {
      params.set("sortBy", sortBy);
    }
    if (sortOrder) {
      params.set("sortOrder", sortOrder);
    }

    if (setOpenSheet) setOpenSheet(false);

    startTransition(() => {
      startProgress();
      router.push(
        `/${
          currentPage === "profiles"
            ? "company/profiles"
            : currentPage === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`
      );
    });
  };

  const inputFilterOnChange = useCallback(
    (name: string, value: string | string[] | undefined) =>
      handleChange({
        target: { name, value },
      } as ChangeEvent<HTMLInputElement>),
    [handleChange]
  );

  const renderInput = (config: FilterConfig) => {
    switch (config.type) {
      case "multi-select":
        return (
          <MultiKeywordSelect
            name={config.name}
            placeholder={config.placeholder}
            initialKeywords={filters[config.name] as string[]}
            onChange={handleMultiKeywordSelectChange}
            className="mt-1 w-full"
            availableItems={config.options?.map((e) => e.value)}
            isVirtualized={config.isVirtualized}
            // loading={isLoading}
          />
        );
      case "multi-select-input":
        return (
          <MultiKeywordSelectInput
            name={config.name}
            placeholder={config.placeholder}
            initialKeywords={filters[config.name] as string[]}
            onChange={handleMultiKeywordSelectChange}
            className="mt-1 w-full"
            availableItems={config.options?.map((e) => e.value)}
          />
        );
      case "number":
      case "text":
        return (
          <InputFilter
            name={String(config.name)}
            type={config.type}
            placeholder={config.placeholder}
            value={filters[config.name]}
            onChange={inputFilterOnChange}
            className="block w-full mt-1 bg-input"
            min={config.type === "number" ? 0 : undefined}
          />
        );
      default:
        return null;
    }
  };

  return (
    <form
      className="flex flex-col h-full  items-start py-4 "
      onSubmit={handleSubmit}
    >
      <div className="w-full flex-1 md:flex-none overflow-y-auto ">
        {FILTER_CONFIG.filter((each) => !each.hidden).map((config) => (
          <label
            key={config.name}
            htmlFor={String(config.name)}
            className="block mb-4"
          >
            <span className="font-medium">{config.label}:</span>
            {renderInput(config)}
          </label>
        ))}
      </div>
      <div className="w-full !pt-4">
        <FilterActions
          currentPage={currentPage}
          // isProfilesPage={currentPage === "profiles"}
          setOpenSheet={setOpenSheet}
          isApplyFiltersLoading={isPending}
        />
      </div>
    </form>
  );
}
