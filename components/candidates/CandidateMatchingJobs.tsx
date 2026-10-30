"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeAddToJob } from "@/helpers/candidates/copy";
import { POOL_MATCH_LABEL } from "@/helpers/candidates/pool-match";
import type { MatchingJob, MatchingJobs } from "@/helpers/candidates/pool-matches";
import { jobPostPath } from "@/helpers/jobs/paths";

export type MatchingJobRow = MatchingJob & {
  /** applicants.import for the job. */
  canAdd: boolean;
};

const NO_EMAIL = "Add an email first";

/**
 * A company candidate's matching jobs on their overview (CP-REQ-062), with
 * "Add to" per job the member can import into. When there's too little to
 * match on, the note that says so instead (CP-REQ-041). `status` is null
 * without talent.view: only the note can show. Without an active job
 * there's nothing to match against, so it says that instead of waiting.
 */
export default function CandidateMatchingJobs({
  candidateId,
  hasEmail,
  canMatch,
  hasOpenJobs = true,
  status,
  matches,
}: {
  candidateId: string;
  hasEmail: boolean;
  canMatch: boolean;
  /** The company has an active job the member can see. */
  hasOpenJobs?: boolean;
  status: Extract<MatchingJobs, { ok: true }>["status"] | null;
  matches: MatchingJobRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (!canMatch) {
    return <p className="rounded-xl border p-4 text-sm">Add a resume or skills to match this person to jobs.</p>;
  }
  if (status === null) return null;

  const add = async (jobId: string) => {
    setBusy(jobId);
    try {
      const result = await addCandidatesToJobAction({ jobPostId: jobId, candidateIds: [candidateId] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(describeAddToJob(result.counts));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const columns: ColumnDef<MatchingJobRow>[] = [
    {
      id: "job",
      header: "Job",
      cell: ({ row }) => (
        <Link href={jobPostPath(row.original.jobId)} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
    },
    {
      id: "similarity",
      header: POOL_MATCH_LABEL,
      cell: ({ row }) => (
        <Badge variant="outline">
          {POOL_MATCH_LABEL} {row.original.score}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) =>
        row.original.canAdd ? (
          // A disabled button gets no hover, so the reason sits on its wrapper.
          <span title={hasEmail ? `Add to ${row.original.title}` : NO_EMAIL}>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Add to ${row.original.title}`}
              disabled={!hasEmail || busy !== null}
              onClick={() => void add(row.original.jobId)}
            >
              {busy === row.original.jobId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-1">Add</span>
            </Button>
          </span>
        ) : null,
      meta: { className: "w-24 text-right", headerClassName: "w-24" },
    },
  ];

  return (
    <section aria-labelledby="matching-jobs-title" className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 id="matching-jobs-title" className="text-base font-semibold">
          Matching jobs
        </h2>
        <p className="text-sm text-muted-foreground">
          Your open jobs closest to this person&apos;s profile. Adding them emails no one.
        </p>
      </div>
      {!hasOpenJobs ? (
        <p className="text-sm text-muted-foreground">
          You have no active jobs. Matching needs at least one active job to run.
        </p>
      ) : status === "not_embedded" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding matching jobs… This takes a minute after their details change.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">None of your open jobs is close to this person yet.</p>
      ) : (
        <DataTable
          aria-label="Matching jobs"
          data={matches}
          columns={columns}
          noun="jobs"
          getRowId={(m) => m.jobId}
          pageSize={null}
        />
      )}
    </section>
  );
}
