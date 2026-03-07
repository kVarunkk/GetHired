import { FilterConfig, FiltersState } from "@/utils/types";

export const getInitialState = (
  config: FilterConfig[],
  searchParams: URLSearchParams,
): FiltersState => {
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

      if (
        filter.name === "createdAfter" &&
        initialState["createdAfter"]?.length
      ) {
        const paramValue = initialState[filter.name]?.[0];
        const filterDisplayValue = filter.options?.find(
          ({ label }) => label === (paramValue ?? "").trim(),
        )?.value;

        if (paramValue && filterDisplayValue) {
          (initialState[filter.name] as string[]) = [filterDisplayValue];
        }
      }
    } else {
      (initialState[filter.name] as string) = paramValue || "";
    }
  });
  return initialState as FiltersState;
};
