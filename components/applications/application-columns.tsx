// The cells the company's application lists share (QF-REQ-023): the job
// page's ApplicantsTable and the server-paged Applications list, so the two
// look the same.
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import MatchScoreBadge from "@/components/matching/MatchScoreBadge";
import KnockoutBadge, { type KnockoutSummary } from "@/components/applications/KnockoutBadge";
import ImportedBadge from "@/components/candidates/ImportedBadge";
import type { ApplicationPerson } from "@/helpers/applications/application-person";
import { isScreeningInProgress, NOT_SCORED_LABEL, type ScreeningStatus } from "@/helpers/matching/screening-view";
import { formatDate } from "@/utils/date";
import type { TApplicationStatus } from "@/utils/types";

/** The applicant's name with the Imported and knockout badges. */
export function ApplicantNameCell({
  name,
  person,
  knockout,
}: {
  name: string;
  person: Pick<ApplicationPerson, "imported" | "hasResume" | "connectedUserId"> | null;
  knockout: KnockoutSummary;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="max-w-[14rem] truncate font-medium" title={name || undefined}>
        {name || "N/A"}
      </div>
      {person && <ImportedBadge person={person} />}
      <KnockoutBadge knockout={knockout} />
    </div>
  );
}

/** The job's title, linking to the job. */
export function JobTitleCell({ jobId, title }: { jobId: string | null | undefined; title: string }) {
  return (
    <div className="max-w-[16rem] truncate text-sm" title={title}>
      <Link href={`/company/job-posts/${jobId}`} className="hover:underline underline underline-offset-4 sm:no-underline">
        {title}
      </Link>
    </div>
  );
}

/** The fit score, "Screening…" while it runs, or why there's none. */
export function FitCell({
  fitScore,
  screeningStatus,
}: {
  fitScore: number | null | undefined;
  screeningStatus: string | null | undefined;
}) {
  if (isScreeningInProgress(screeningStatus as ScreeningStatus | undefined)) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Screening…
      </span>
    );
  }
  if (fitScore !== null && fitScore !== undefined) {
    return <MatchScoreBadge score={fitScore} className="whitespace-nowrap" />;
  }
  if (screeningStatus === "insufficient_info") {
    return <span className="whitespace-nowrap text-sm text-muted-foreground">{NOT_SCORED_LABEL}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

export function StatusCell({ status }: { status: string | null }) {
  return <ApplicationStatusBadge status={status as TApplicationStatus} />;
}

export function DateCell({ date }: { date: string | null }) {
  return <div className="text-sm ">{formatDate(date)}</div>;
}

export function ViewApplicationCell({ id }: { id: string }) {
  return (
    <Link href={`/company/applications/${id}`}>
      <Button variant="ghost" size="sm">
        View Application
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </Link>
  );
}
