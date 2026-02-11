"use client";

import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  FolderSearch,
  Loader2,
  PlusCircle,
  Search,
  Sparkle,
} from "lucide-react";
import { User } from "@supabase/supabase-js";
import toast from "react-hot-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IJobPost } from "./JobPostingsTable";
import { SelectGroup } from "@radix-ui/react-select";
import Link from "next/link";
import { useProgress } from "react-transition-progress";
import { Button } from "./ui/button";
import InfoTooltip from "./InfoTooltip";
import { TAICredits } from "@/lib/types";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/lib/utils";

export default function FindSuitableJobs({
  user,
  setPage,
  currentPage,
  companyId,
}: {
  user: User | null;
  setPage: Dispatch<SetStateAction<number>>;
  currentPage: "jobs" | "profiles" | "companies";
  companyId?: string;
}) {
  const [suitableJobsSelectValue, setSuitableJobsSelectValue] = useState("");
  const [jobPostings, setJobPostings] = useState<IJobPost[]>([]);
  const router = useRouter();
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const startProgress = useProgress();
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  const findCompanyUsersJobPostings = useCallback(async (): Promise<
    IJobPost[]
  > => {
    if (!companyId || !supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from("job_postings")
      .select("id, title")
      .eq("company_id", companyId);

    if (error) {
      // console.error("Error fetching job postings:", error);
      return [];
    }

    return data as IJobPost[];
  }, [companyId, supabase]);

  useEffect(() => {
    (async () => {
      const job_postings = await findCompanyUsersJobPostings();
      if (job_postings.length > 0) {
        setJobPostings(job_postings);
      }
    })();
  }, [findCompanyUsersJobPostings]);

  const handleFindSuitableJobs = async () => {
    try {
      if (!user) throw new Error("User not found");
      // 2. Fetch user_info
      const { data: userInfo, error: userInfoError } = await supabase
        .from("user_info")
        .select(
          "desired_roles, preferred_locations, job_type, visa_sponsorship_required, min_salary, experience_years",
        )
        .eq("user_id", user.id)
        .single();

      if (userInfoError && userInfoError.code !== "PGRST116") {
        toast.error("Failed to load your profile. Please try again.");
        return;
      }

      if (!userInfo) {
        toast.error("Please complete your profile first.");
        router.push("/get-started");
        return;
      }

      // 3. Construct URLSearchParams based on user_info
      const params = new URLSearchParams();

      const currentSortBy = searchParams.get("sortBy");
      const currentSortOrder = searchParams.get("sortOrder");
      if (currentSortBy && currentSortBy !== "relevance")
        params.set("sortBy", currentSortBy);
      if (currentSortOrder) params.set("sortOrder", currentSortOrder);

      const addMultiParam = (paramName: string, values: string[] | null) => {
        if (values && values.length > 0) {
          params.set(paramName, values.join("|"));
        }
      };

      addMultiParam("jobTitleKeywords", userInfo.desired_roles);
      addMultiParam("location", userInfo.preferred_locations);
      addMultiParam("jobType", userInfo.job_type);
      addMultiParam(
        "visaRequirement",
        userInfo.visa_sponsorship_required
          ? ["US Citizenship/Visa Not Required", "Will Sponsor"]
          : ["US Citizenship/Visa Not Required", "US Citizen/Visa Only"],
      );

      if (userInfo.min_salary) {
        params.set("minSalary", userInfo.min_salary.toString());
      }
      if (userInfo.experience_years) {
        params.set("minExperience", userInfo.experience_years.toString());
      }

      startTransition(() => {
        startProgress();
        router.push(`/jobs?${params.toString()}`);
      });
    } catch (error: unknown) {
      toast.error(
        `An unexpected error occurred: ${
          error instanceof Error ? error.message : "Please try again."
        }`,
      );
    }
  };

  const handleAiSearch = async (value?: string) => {
    try {
      const params = new URLSearchParams();
      params.set("sortBy", "relevance");
      if (value) {
        params.set("job_post", value);
      }
      setPage(() => 1);
      // toast.loading(
      //   "This might take a moment. Our AI is finding the best " +
      //     `${currentPage}` +
      //     " out there for you."
      // );
      // await revalidateCache("jobs-feed");
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
            className="rounded-full bg-primary shadow-lg w-[200px]"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <SelectValue
              placeholder={
                <p className="flex items-center gap-2 text-primary-foreground">
                  <Search className="w-4 h-4" /> Find Suitable Profiles
                </p>
              }
            />
          </SelectTrigger>
          <SelectGroup>
            <SelectContent>
              <SelectLabel className="flex items-center text-sm justify-between gap-4 w-[200px]">
                <div className="flex flex-col gap-1">
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
              {jobPostings.map((each) => (
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
              {`AI Smart Search uses ${TAICredits.AI_SEARCH_OR_ASK_AI} AI credits per use. ${
                data && data.profile
                  ? `${data.profile.ai_credits} AI Credits available.`
                  : ""
              }`}{" "}
              <Link href={"/dashboard"} className="text-blue-500">
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
          disabled={isPending}
          onClick={() => handleAiSearch()}
          className="rounded-full bg-primary shadow-lg "
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Search className="w-4 h-4" /> Find Suitable Companies
        </Button>

        <InfoTooltip
          content={
            <p>
              <Sparkle className="h-3 w-3 inline-block mr-1" />
              {`AI Smart Search uses ${TAICredits.AI_SEARCH_OR_ASK_AI} AI credits per use. ${
                data && data.profile
                  ? `${data.profile.ai_credits} AI Credits available.`
                  : ""
              }`}{" "}
              <Link href={"/dashboard"} className="text-blue-500">
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
      <Select
        value={suitableJobsSelectValue}
        onValueChange={(value) => {
          setSuitableJobsSelectValue(value);
          if (value === "find-suitable") {
            handleFindSuitableJobs();
          }
          if (value === "ai-job-search") {
            handleAiSearch();
          }
          setTimeout(() => setSuitableJobsSelectValue(""), 100);
        }}
      >
        <SelectTrigger
          disabled={isPending}
          className="rounded-full bg-primary shadow-lg w-[180px] !text-primary-foreground"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <SelectValue
            placeholder={
              <p className="flex items-center gap-2 ">Find Suitable Jobs</p>
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="find-suitable">
            <div className="w-full flex items-center gap-2">
              {" "}
              <FolderSearch className="h-4 w-4" />
              Find Jobs Matching My Profile
            </div>
          </SelectItem>
          <SelectItem value="ai-job-search">
            <div className="w-full flex items-center gap-2">
              <Sparkle className="h-4 w-4" />
              AI Smart Search
            </div>
          </SelectItem>
          {/* You could add more options here if needed, e.g., "Reset to default" */}
        </SelectContent>
      </Select>

      <InfoTooltip
        content={
          <p>
            <Sparkle className="h-3 w-3 inline-block mr-1" />
            {`AI Smart Search uses ${TAICredits.AI_SEARCH_OR_ASK_AI} AI credits per use. ${
              data && data.profile
                ? `${data.profile.ai_credits} AI Credits available.`
                : ""
            }`}{" "}
            <Link href={"/dashboard"} className="text-blue-500">
              Recharge Credits
            </Link>
          </p>
        }
      />
    </div>
  );
}
