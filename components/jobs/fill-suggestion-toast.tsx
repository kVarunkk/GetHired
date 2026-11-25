"use client";

import Link from "next/link";
import toast from "react-hot-toast";
import type { FillSuggestion } from "@/helpers/jobs/job-hires";
import { jobPostPath } from "@/helpers/jobs/paths";

/**
 * After a stage move, one toast per job whose hires just reached its openings
 * (JL-REQ-013, D5). It links to the job's Overview, where `jobs.publish` can
 * mark it as filled; nothing changes by itself.
 */
export function toastFillSuggestions(suggestions: readonly FillSuggestion[] | undefined) {
  for (const job of suggestions ?? []) {
    toast(
      () => (
        <span className="text-sm">
          {job.title} has hired {job.hires} of {job.openings}.{" "}
          <Link href={jobPostPath(job.jobPostId)} className="font-medium underline underline-offset-4">
            Mark it as filled
          </Link>
        </span>
      ),
      { id: `fill-${job.jobPostId}`, duration: 10_000 },
    );
  }
}
