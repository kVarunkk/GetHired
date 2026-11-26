"use client";

import { useState } from "react";
import useSWR from "swr";
import MultiKeywordSelect, { GenericFormData } from "./MultiKeywordSelect";
import { useDebounce } from "@/hooks/useDebounce";

type CompaniesResponse = { companies: { company_name: string }[] };

const fetchCompanies = async (url: string): Promise<CompaniesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load companies");
  return res.json();
};

interface CompanySearchSelectProps {
  name: keyof GenericFormData;
  onChange: (name: keyof GenericFormData, keywords: string[]) => void;
  placeholder?: string;
  initialCompanies?: string[];
  className?: string;
}

/** The jobs page's company filter. It searches on the server: there are too many companies to load. */
export default function CompanySearchSelect({
  name,
  onChange,
  placeholder,
  initialCompanies,
  className,
}: CompanySearchSelectProps) {
  const [term, setTerm] = useState("");
  const query = term.trim();
  const debouncedQuery = useDebounce(query, 300);

  const { data, error, isLoading } = useSWR(
    `/api/jobs/filters?query=${encodeURIComponent(debouncedQuery)}`,
    fetchCompanies,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
      // The last matches stay up while the next ones load.
      keepPreviousData: true,
    },
  );

  const searching = isLoading || query !== debouncedQuery;

  return (
    <MultiKeywordSelect
      name={name}
      onChange={onChange}
      placeholder={placeholder}
      initialKeywords={initialCompanies}
      className={className}
      availableItems={data?.companies.map((company) => company.company_name)}
      search={{
        term,
        onTermChange: setTerm,
        loading: searching,
        emptyMessage: error ? "Couldn't load companies. Try again." : "No companies found",
      }}
    />
  );
}
