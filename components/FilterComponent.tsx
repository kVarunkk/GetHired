"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  useState,
  ChangeEvent,
  useTransition,
  SetStateAction,
  Dispatch,
  useCallback,
  useMemo,
} from "react";
import MultiKeywordSelect, { GenericFormData } from "./MultiKeywordSelect";
import MultiKeywordSelectInput from "./MultiKeywordSelectInput";
import InputFilter from "./InputFilterComponent";
import { FilterConfig, FiltersState, PostHogEvent } from "@/utils/types";
import { useProgress } from "react-transition-progress";
import FilterActions from "./FilterActions";
import { useFilterOptions } from "@/hooks/useFilterOptions";
import { filterConfigBuilder } from "@/helpers/filter-component/filterConfigBuilder";
import { getInitialState } from "@/helpers/filter-component/getInitialState";
import LocationSearchSelect from "./LocationSearchSelect";
import ScrollFade from "./ScrollFade";
import posthog from "@/lib/posthog/client";

export default function FilterComponent({
  setOpenSheet,
  currentPage,
  onboardingComplete,
  dynamicKey,
}: {
  setOpenSheet?: Dispatch<SetStateAction<boolean>>;
  currentPage: "jobs" | "profiles" | "companies";
  onboardingComplete: boolean;
  dynamicKey: string;
}) {
  const router = useRouter();
  const searchParams = useMemo(
    () => new URLSearchParams(dynamicKey),
    [dynamicKey],
  );
  const startProgress = useProgress();
  const [isPending, startTransition] = useTransition();

  const {
    uniqueCompanies,
    uniqueLocations,
    uniqueJobRoles,
    uniqueIndustryPreferences,
    uniqueSkills,
    uniqueWorkStylePreferences,
    uniqueIndustries,
  } = useFilterOptions(currentPage);

  const FILTER_CONFIG: FilterConfig[] = useMemo(() => {
    return filterConfigBuilder(
      currentPage,
      uniqueCompanies,
      uniqueLocations,
      uniqueJobRoles,
      uniqueIndustryPreferences,
      uniqueSkills,
      uniqueWorkStylePreferences,
      uniqueIndustries,
      onboardingComplete,
    );
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
  ]);

  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const tab = searchParams.get("tab");

  const currentUrlFilters = useMemo(() => {
    return getInitialState(FILTER_CONFIG, searchParams);
  }, [FILTER_CONFIG, searchParams]);

  const [filters, setFilters] = useState<FiltersState>(currentUrlFilters);
  const [prevKey, setPrevKey] = useState(dynamicKey);

  if (dynamicKey !== prevKey) {
    setPrevKey(dynamicKey);
    setFilters(currentUrlFilters);
  }

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFilters((prevFilters) => ({
      ...prevFilters,
      [name as keyof FiltersState]: value,
    }));
  }, []);

  const handleMultiKeywordSelectChange = useCallback(
    (name: keyof GenericFormData, keywords: string[]) => {
      setFilters((prevFilters) => ({
        ...prevFilters,
        [name]: keywords,
      }));
    },
    [],
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
        filterConfig?.type === "multi-select-input" ||
        filterConfig?.type === "location-search-select"
      ) {
        if (Array.isArray(value) && value.length > 0) {
          if (filterConfig.name === "createdAfter") {
            const selectedValue = value[0].trim();
            value[0] =
              filterConfig.options?.find(({ value }) => value === selectedValue)
                ?.label ?? "";
          }
          params.set(key, value.join("|"));
        }
      } else {
        if (value && value !== "") {
          params.set(key, value.toString());
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

    posthog.capture(PostHogEvent.JobSearchPerformed, {
      tab,
      filters_used: Object.keys(filters).filter((key) => {
        const filterKey = key as keyof FiltersState;
        const value = filters[filterKey];
        return (
          value &&
          value !== "" &&
          (Array.isArray(value) ? value.length !== 0 : true)
        );
      }),
      filter_count: Object.keys(filters).filter((key) => {
        const filterKey = key as keyof FiltersState;
        const value = filters[filterKey];
        return (
          value &&
          value !== "" &&
          (Array.isArray(value) ? value.length !== 0 : true)
        );
      }).length,
      sort_by: sortBy,
      sort_order: sortOrder,
    });
    startTransition(() => {
      startProgress();
      router.push(
        `/${
          currentPage === "profiles"
            ? "company/profiles"
            : currentPage === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`,
      );
    });
  };

  const inputFilterOnChange = useCallback(
    (name: string, value: string | string[] | number | undefined) =>
      handleChange({
        target: { name, value },
      } as ChangeEvent<HTMLInputElement>),
    [handleChange],
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
            isSingleSelect={config.isSingleSelect}
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

      case "location-search-select":
        return (
          <LocationSearchSelect
            name={config.name}
            initialLocations={filters[config.name] as string[]}
            onChange={handleMultiKeywordSelectChange}
            placeholder={config.placeholder}
            isSingleSelect={false}
            className="mt-1 w-full"
          />
        );

      case "number":
      case "text":
        return (
          <InputFilter
            key={dynamicKey}
            name={String(config.name)}
            type={config.type}
            placeholder={config.placeholder}
            value={filters[config.name]}
            onChange={inputFilterOnChange}
            className="block w-full mt-1"
            min={config.type === "number" ? 0 : undefined}
          />
        );
      default:
        return null;
    }
  };

  return (
    <form
      className="flex min-h-0 flex-col h-full lg:h-screen items-start"
      onSubmit={handleSubmit}
    >
      {/* No scrollbar: a fade at the bottom (and at the top once scrolled) shows there are more filters. */}
      <ScrollFade className="w-full flex-1" contentClassName="py-4 lg:pr-4">
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
      </ScrollFade>
      <div className="w-full shrink-0 py-4 lg:pr-4">
        <FilterActions
          currentPage={currentPage}
          setOpenSheet={setOpenSheet}
          isApplyFiltersLoading={isPending}
        />
      </div>
    </form>
  );
}
