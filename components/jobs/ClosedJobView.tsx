"use client";

import Link from "next/link";
import useSWR from "swr";
import { Ban, MapPin } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import JobMarkdown from "@/components/JobMarkdown";
import { myApplicationHref } from "@/helpers/tracker/applied-state";
import { formatDate } from "@/utils/date";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import type { TJobIdPageData } from "@/utils/types/jobs.types";

/**
 * A job that's no longer open: what it was, read-only, with no way to apply
 * or save it. Someone who applied gets a link to their own record of it, so a
 * closed posting never strands them on a 404.
 */
export default function ClosedJobView({ job, browseHref }: { job: TJobIdPageData; browseHref: string }) {
  const { data: currentUser } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });
  const applicationHref = currentUser?.role === "applicant" ? myApplicationHref(currentUser.profile, job.id) : null;
  const locations = [...new Set(job.locations ?? [])].filter((loc): loc is string => !!loc);
  const text = job.description?.trim() || job.ai_summary?.trim() || null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[28px]">{job.job_name}</h1>
        <p className="text-lg text-muted-foreground">at {job.company_name}</p>
        <p className="text-sm text-muted-foreground">Posted on {formatDate(job.created_at, { dateStyle: "long" }, "en-US")}</p>
        {locations.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
            {locations.map((loc) => (
              <Badge key={loc} variant="secondary">
                {loc}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Alert>
        <Ban className="h-4 w-4" aria-hidden />
        <AlertTitle>This job is no longer accepting applications</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            {applicationHref
              ? "The company has closed this posting. Your application and notes are still in My Jobs."
              : "The company has closed this posting."}
          </p>
          <div className="flex flex-wrap gap-2">
            {applicationHref && (
              <Button asChild variant="brand" size="sm">
                <Link href={applicationHref}>View your application</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={browseHref}>Browse open jobs</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      {text && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About the job</CardTitle>
          </CardHeader>
          <CardContent>
            <JobMarkdown>{text}</JobMarkdown>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
