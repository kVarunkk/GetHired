"use client";

import { useState, useTransition } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./ui/drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/utils";
import { Check, ChevronsUpDown, Loader2, Search, Sparkle } from "lucide-react";
import { User } from "@supabase/supabase-js";
import toast from "react-hot-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProgress } from "react-transition-progress";
import { Button } from "./ui/button";
import { PostHogEvent } from "@/utils/types";
import useSWR from "swr";
import posthog from "@/lib/posthog/client";

const fetchCompanyJobs = async (companyId: string) => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("company_id", companyId);

  if (error) throw error;
  return data || [];
};

export default function FindSuitableJobs({
  user,
  currentPage,
  companyId,
}: {
  user: User | null;
  currentPage: "jobs" | "profiles" | "companies";
  companyId?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  // The same breakpoint as the other searchable pickers (LocationSearchSelect).
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const selectedJobPost = useSearchParams()?.get("job_post");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const startProgress = useProgress();
  const shouldFetch = currentPage === "profiles" && !!companyId;
  const { data: jobPostings } = useSWR(
    shouldFetch ? `company-jobs-${companyId}` : null,
    () => fetchCompanyJobs(companyId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  const handleAiSearch = async (value?: string) => {
    try {
      const params = new URLSearchParams();
      params.set("sortBy", "relevance");
      if (value) {
        params.set("job_post", value);
      }
      posthog.capture(PostHogEvent.AiSearchUsed, {
        user_type: user?.app_metadata?.type,
      });

      startTransition(() => {
        startProgress();
        router.push(
          `/${
            currentPage === "profiles"
              ? "company/profile"
              : currentPage === "jobs"
                ? "job"
                : "companie"
          }s?${params.toString()}`,
          // Keep the reader's place: starting a search shouldn't jump to the page top.
          { scroll: false },
        );
      });
    } catch {
      toast.error("Some error occured with AI Smart Search, Please try again");
    }
  };

  if (currentPage === "profiles" && companyId) {
    const trigger = (
      <Button variant="brand" disabled={isPending} className="rounded-full whitespace-nowrap">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        AI Smart Search
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      </Button>
    );

    const query = jobSearch.trim().toLowerCase();
    const matches = jobPostings?.filter((job) => job.title.toLowerCase().includes(query));

    const list = (
      // Filtered here, like the other pickers. A row's value is its id, since titles can repeat.
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search job posts..." value={jobSearch} onValueChange={setJobSearch} />
        <CommandList>
          {!matches ? (
            <div className="h-60 w-full flex items-center justify-center">
              <Loader2 className="animate-spin text-muted-foreground" aria-label="Loading job posts" />
            </div>
          ) : (
            <div className="h-60 overflow-y-auto p-1">
              <CommandEmpty className="text-muted-foreground text-center py-6 text-sm">
                No matching items found
              </CommandEmpty>
              {matches.map((each) => (
                <CommandItem
                  key={each.id}
                  value={each.id}
                  onSelect={() => {
                    setPickerOpen(false);
                    handleAiSearch(each.id);
                  }}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      selectedJobPost === each.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{each.title}</span>
                </CommandItem>
              ))}
            </div>
          )}
        </CommandList>
      </Command>
    );

    return (
      <div className="flex items-center ">
        {isDesktop ? (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className="p-0" align="end" style={{ pointerEvents: "auto" }}>
              {list}
            </PopoverContent>
          </Popover>
        ) : (
          <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
            <DrawerTrigger asChild>{trigger}</DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle></DrawerTitle>
                <DrawerDescription>Select a job post</DrawerDescription>
              </DrawerHeader>
              <div className="border-t">{list}</div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    );
  }

  if (currentPage === "companies") {
    return (
      <div className="flex items-center ">
        <Button
          variant="brand"
          disabled={isPending}
          onClick={() => handleAiSearch()}
          className="rounded-full whitespace-nowrap"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Search className="w-4 h-4" /> Find Suitable Companies
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center ">
      <Button
        variant="brand"
        disabled={isPending}
        onClick={() => handleAiSearch()}
        className="rounded-full whitespace-nowrap"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkle className="h-4 w-4" />
        )}
        AI Smart Search
      </Button>
    </div>
  );
}
