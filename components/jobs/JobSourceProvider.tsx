"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { readSourceTag, sourceTagQuery } from "@/helpers/distribution/source-tag";
import { jobApplyPath } from "@/helpers/jobs/apply-path";
import { ApplicationSourceProvider } from "./ApplicationSourceContext";

/** MP-REQ-006: records a job-board application and keeps the tag through sign-up. */
export default function JobSourceProvider({ jobId, children }: { jobId: string; children: ReactNode }) {
  const searchParams = useSearchParams();
  const tag = useMemo(() => readSourceTag(new URLSearchParams(searchParams.toString())), [searchParams]);
  if (!tag) return <>{children}</>;
  return (
    <ApplicationSourceProvider
      value={{
        source: "job_board",
        ref: tag.channel,
        returnTo: `/jobs/${jobId}?${sourceTagQuery(tag)}`,
        applyHref: jobApplyPath(jobId, tag),
      }}
    >
      {children}
    </ApplicationSourceProvider>
  );
}
