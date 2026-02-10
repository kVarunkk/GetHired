"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import FilterComponent from "./FilterComponent";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function FilterComponentSheet({
  currentPage,
  onboardingComplete,
}: {
  currentPage: "jobs" | "companies" | "profiles";
  onboardingComplete: boolean;
}) {
  const [openSheet, setOpenSheet] = useState(false);
  const searchParams = useSearchParams();

  const filtersApplied: {
    id: string;
    name: string;
    value: string;
  }[] = [];

  if (searchParams.size > 0) {
    searchParams.forEach((value, key) => {
      if (
        key !== "sortOrder" &&
        key !== "sortBy" &&
        key !== "job_post" &&
        key !== "tab"
      ) {
        filtersApplied.push({
          id: uuidv4(),
          name: key,
          value,
        });
      }
    });
  }

  return (
    <Sheet open={openSheet} onOpenChange={setOpenSheet}>
      <SheetTrigger className="md:hidden underline underline-offset-2 text-primary py-2 pr-2">
        {filtersApplied.length > 0
          ? `${filtersApplied.length} Filter${
              filtersApplied.length > 1 ? "s" : ""
            } Applied`
          : "Apply Filters"}
      </SheetTrigger>
      <SheetContent side={"left"} className="h-full w-full">
        <SheetHeader>
          <SheetTitle>
            <span className="capitalize">{currentPage}</span> Search Filters
          </SheetTitle>
        </SheetHeader>
        <FilterComponent
          currentPage={currentPage}
          setOpenSheet={setOpenSheet}
          onboardingComplete={onboardingComplete}
        />
      </SheetContent>
    </Sheet>
  );
}
