import Link from "next/link";
import { MapPin } from "lucide-react";
import type { RecommendedJobs as Recommended } from "@/helpers/dashboard/recommended-jobs";
import DashboardSection from "./DashboardSection";

export const MATCHES_PATH = "/jobs?sortBy=relevance";

const linkClass = "font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground";

function EmptyState({ state }: { state: Recommended["state"] }) {
  const body = {
    no_profile: (
      <>
        <Link className={linkClass} href="/get-started">
          Finish your profile
        </Link>{" "}
        and we&apos;ll match you with jobs that fit.
      </>
    ),
    processing: <>We&apos;re finding your matches. This usually takes a few minutes, and we&apos;ll email you when they&apos;re ready.</>,
    not_run: (
      <>
        Your matches haven&apos;t been generated yet.{" "}
        <Link className={linkClass} href={MATCHES_PATH}>
          Generate them now
        </Link>
        .
      </>
    ),
    failed: (
      <>
        We couldn&apos;t generate your matches.{" "}
        <Link className={linkClass} href={MATCHES_PATH}>
          Try again
        </Link>
        .
      </>
    ),
    ready: (
      <>
        You&apos;ve applied to or saved all your top matches.{" "}
        <Link className={linkClass} href={MATCHES_PATH}>
          See more
        </Link>
        .
      </>
    ),
  }[state];
  return <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">{body}</p>;
}

/** "Matched for you": the top of the user's relevance feed, minus jobs they applied to or saved. */
export default function RecommendedJobs({ recommended }: { recommended: Recommended }) {
  const jobs = recommended.state === "ready" ? recommended.jobs : [];

  return (
    <DashboardSection
      title="Matched for you"
      action={recommended.state === "ready" ? { label: "See all matches", href: MATCHES_PATH } : undefined}
    >
      {jobs.length === 0 ? (
        <EmptyState state={recommended.state} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="group flex flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium underline-offset-4 group-hover:underline">{job.jobTitle}</span>
                  <span className="text-sm text-muted-foreground">{job.companyName}</span>
                </div>
                {job.location && (
                  <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {job.location}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
