"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useProgress } from "react-transition-progress";

export default function SortingComponent({
  isCompanyUser,
  currentPage,
}: {
  isCompanyUser: boolean;
  currentPage: "jobs" | "companies" | "profiles";
}) {
  const startProgress = useProgress();
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();

  const selectValue =
    searchParams.get("sortBy") &&
    searchParams.get("sortOrder") &&
    searchParams.get("sortBy") !== "relevance"
      ? searchParams.get("sortBy") + "-" + searchParams.get("sortOrder")
      : "";

  const handleSorting = async (value: string) => {
    const [column, order] = value.split("-");
    const params = new URLSearchParams(searchParams.toString());
    params.set("sortBy", column);
    params.set("sortOrder", order);

    startTransition(() => {
      startProgress();

      router.push(
        `/${
          currentPage === "profiles" && isCompanyUser
            ? "company/profiles"
            : currentPage === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`,
      );
    });
  };

  return (
    <Select value={selectValue} onValueChange={(value) => handleSorting(value)}>
      <SelectTrigger
        disabled={isPending}
        className="max-w-[120px] lg:max-w-full bg-input"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        <SelectValue placeholder="Sort By" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="created_at-desc">Newest First</SelectItem>
        <SelectItem value="created_at-asc">Oldest First</SelectItem>
        <SelectItem
          value={`${
            isCompanyUser && currentPage === "profiles"
              ? "full_name"
              : currentPage === "jobs"
                ? "company_name"
                : "name"
          }-asc`}
        >
          {currentPage === "profiles" ? "Profile" : "Company"} Name (A-Z)
        </SelectItem>
        <SelectItem
          value={`${
            isCompanyUser && currentPage === "profiles"
              ? "full_name"
              : currentPage === "jobs"
                ? "company_name"
                : "name"
          }-desc`}
        >
          {currentPage === "profiles" ? "Profile" : "Company"} Name (Z-A)
        </SelectItem>
        {currentPage !== "companies" && (
          <SelectItem
            value={`${
              isCompanyUser && currentPage === "profiles"
                ? "min_salary"
                : "salary_min"
            }-asc`}
          >
            Lowest Salary First
          </SelectItem>
        )}
        {currentPage !== "companies" && (
          <SelectItem
            value={`${
              isCompanyUser && currentPage === "profiles"
                ? "min_salary"
                : "salary_min"
            }-desc`}
          >
            Highest Salary First
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
