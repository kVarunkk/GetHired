"use client";

import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { startTransition } from "react";
import { useProgress } from "react-transition-progress";

export default function FindSuitableProfilesForJobPost({
  job_post_id,
}: {
  job_post_id: string;
}) {
  const router = useRouter();
  const startProgress = useProgress();

  const handleAiSearch = async (value?: string) => {
    try {
      const params = new URLSearchParams();
      params.set("sortBy", "relevance");
      if (value) {
        params.set("job_post", value);
      }

      startTransition(() => {
        startProgress();
        router.push(`/${"company/profile"}s?${params.toString()}`);
      });
    } catch {
      toast.error("Some error occured with AI Smart Search, Please try again");
    }
  };

  if (job_post_id) {
    return (
      <Button
        variant="brand"
        className="rounded-full"
        onClick={() => handleAiSearch(job_post_id)}
      >
        <Search className="w-4 h-4" />
        AI Smart Search
      </Button>
    );
  } else return "";
}
