import InterviewConfigSection from "./InterviewConfigSection";
import type { InterviewConfig } from "@/helpers/interview/screening/schemas";
import type { InterviewFunnel } from "@/helpers/interview/screening/funnel";

/** The job page's interview funnel (SI-REQ-004, SIT-061). */
export function InterviewFunnelStrip({ funnel }: { funnel: InterviewFunnel }) {
  const stats = [
    { label: "Invited", value: funnel.invited },
    { label: "Waiting", value: funnel.waiting },
    { label: "In progress", value: funnel.inProgress },
    { label: "Completed", value: funnel.completed },
    { label: "Expired", value: funnel.expired },
    { label: "Declined", value: funnel.declined },
    { label: "Average score", value: funnel.avgScore === null ? "–" : `${funnel.avgScore.toFixed(1)} / 5` },
  ];
  return (
    <dl aria-label="Interview funnel" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-7">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-background px-3 py-2">
          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A job's AI interview page body: funnel, the skipped-invites notice and
 * the config. Rendered only for members with interviews.view on the job.
 */
export default function JobInterviewPanel({
  jobPostId,
  config,
  funnel,
  uninvitedAboveThreshold,
  canEdit,
}: {
  jobPostId: string;
  config: InterviewConfig | null;
  funnel: InterviewFunnel;
  uninvitedAboveThreshold: number;
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
        {(config?.enabled || funnel.invited > 0) && <InterviewFunnelStrip funnel={funnel} />}
        {uninvitedAboveThreshold > 0 && (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            {uninvitedAboveThreshold} applicant{uninvitedAboveThreshold === 1 ? "" : "s"} scored above the bar but
            weren&apos;t invited, usually because the interview minutes ran out. Add minutes or credits, then invite
            them from the applicants list.
          </p>
        )}
        <InterviewConfigSection jobPostId={jobPostId} initialConfig={config} canEdit={canEdit} />
    </div>
  );
}
