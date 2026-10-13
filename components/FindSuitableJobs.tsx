"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Loader2, PlusCircle, Search, Sparkle } from "lucide-react";
import { User } from "@supabase/supabase-js";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SelectGroup } from "@radix-ui/react-select";
import Link from "next/link";
import { useProgress } from "react-transition-progress";
import { Button } from "./ui/button";
import InfoTooltip from "./InfoTooltip";
import { PostHogEvent, TAICredits } from "@/utils/types";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import posthog from "posthog-js";

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
  const [suitableJobsSelectValue, setSuitableJobsSelectValue] = useState("");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const startProgress = useProgress();
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const shouldFetch = currentPage === "profiles" && !!companyId;
  const { data: jobPostings } = useSWR(
    shouldFetch ? `company-jobs-${companyId}` : null,
    () => fetchCompanyJobs(companyId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      staleTime: 10 * 60 * 1000,
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
        );
      });
    } catch {
      toast.error("Some error occured with AI Smart Search, Please try again");
    }
  };

  if (currentPage === "profiles" && companyId) {
    return (
      <div className="flex items-center ">
        <Select
          value={suitableJobsSelectValue}
          onValueChange={(value) => {
            setSuitableJobsSelectValue(value);
            handleAiSearch(value);
            setTimeout(() => setSuitableJobsSelectValue(""), 100);
          }}
        >
          <SelectTrigger
            disabled={isPending}
            className="rounded-full border-brand bg-brand hover:bg-brand/90 hover:border-brand w-[200px]"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <SelectValue
              placeholder={
                <p className="flex items-center gap-2 text-brand-foreground">
                  <Search className="w-4 h-4" /> Find Suitable Profiles
                </p>
              }
            />
          </SelectTrigger>
          <SelectGroup>
            <SelectContent>
              <SelectLabel className="flex items-center text-sm justify-between gap-4 ">
                <div className="flex flex-col gap-1 w-[200px]">
                  <p>Select a Job Posting</p>
                  <p className="text-xs text-muted-foreground">
                    Suitable Profiles will be found according to the selected
                    job post
                  </p>
                </div>
                <Link href={"/company/job-posts"}>
                  <PlusCircle className="h-4 w-4" />
                </Link>
              </SelectLabel>
              <SelectSeparator />
              {jobPostings?.map((each) => (
                <SelectItem key={each.id} value={each.id}>
                  {each.title}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectGroup>
        </Select>

        <InfoTooltip
          content={
            <p>
              <Sparkle className="h-3 w-3 inline-block mr-1" />
              {`AI Smart Search uses ${TAICredits.AI_SEARCH_ASK_AI_RESUME} AI credits per use. ${
                data && data.profile
                  ? `${data.profile.ai_credits} AI Credits available.`
                  : ""
              }`}{" "}
              <Link
                href={"/dashboard/buy-credits"}
                className="font-medium underline underline-offset-4"
              >
                Recharge Credits
              </Link>
            </p>
          }
        />
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
          className="rounded-full"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Search className="w-4 h-4" /> Find Suitable Companies
        </Button>

        <InfoTooltip
          content={
            <p>
              <Sparkle className="h-3 w-3 inline-block mr-1" />
              {`AI Smart Search uses ${TAICredits.AI_SEARCH_ASK_AI_RESUME} AI credits per use. ${
                data && data.profile
                  ? `${data.profile.ai_credits} AI Credits available.`
                  : ""
              }`}{" "}
              <Link
                href={"/dashboard/buy-credits"}
                className="font-medium underline underline-offset-4"
              >
                Recharge Credits
              </Link>
            </p>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex items-center ">
      <Button
        variant="brand"
        disabled={isPending}
        onClick={() => handleAiSearch()}
        className="rounded-full"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkle className="h-4 w-4" />
        )}
        AI Smart Search
      </Button>

      <InfoTooltip
        content={
          <p>
            <Sparkle className="h-3 w-3 inline-block mr-1" />
            {`AI Smart Search uses ${TAICredits.AI_SEARCH_ASK_AI_RESUME} AI credits per use. ${
              data && data.profile
                ? `${data.profile.ai_credits} AI Credits available.`
                : ""
            }`}{" "}
            <Link
              href={"/dashboard/buy-credits"}
              className="font-medium underline underline-offset-4"
            >
              Recharge Credits
            </Link>
          </p>
        }
      />
    </div>
  );
}
