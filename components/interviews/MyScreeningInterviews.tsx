import Link from "next/link";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardSection from "@/components/dashboard/DashboardSection";
import DismissScreeningInterview from "@/components/interviews/DismissScreeningInterview";
import { cn } from "@/utils/utils";
import {
  screeningCardState,
  visibleOnDashboard,
} from "@/helpers/interview/screening/dashboard-state";
import type { MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";
import { formatDate } from "@/utils/date";

export const ALL_SCREENING_INTERVIEWS_PATH = "/interview?tab=companies";

const invitedOn = (iso: string) => formatDate(iso);

/**
 * The applicant's AI interviews from companies: status, deadline and what to
 * do next (SIT-054). On the dashboard ("dashboard") only open and recently
 * submitted ones, each removable once there's nothing left to do; on the
 * Interviews page's "From companies" tab ("all") every one, newest first,
 * with no heading of its own.
 */
export default function MyScreeningInterviews({
  interviews,
  now = new Date(),
  variant = "dashboard",
}: {
  interviews: MyScreeningInterview[];
  now?: Date;
  variant?: "dashboard" | "all";
}) {
  const all = variant === "all";
  const visible = all
    ? [...interviews].sort((a, b) => b.created_at.localeCompare(a.created_at))
    : interviews.filter((interview) => visibleOnDashboard(interview, now));

  if (visible.length === 0) {
    return all ? (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        When a company you apply to invites you to an AI interview, it shows up
        here.
      </p>
    ) : null;
  }

  const list = (
    <ul className="divide-y rounded-xl border">
      {visible.map((interview) => {
        const state = screeningCardState(interview, now);
        return (
          <li
            key={interview.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Mic className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-medium">{interview.job_title}</p>
                <p className="text-sm text-muted-foreground">
                  {interview.company_name}
                  {all && <> · Invited {invitedOn(interview.created_at)}</>}
                </p>
                <p
                  className={cn(
                    "text-sm",
                    state.tone === "action"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {state.label}
                </p>
              </div>
            </div>
            {(state.cta || (!all && state.dismissable)) && (
              <div className="flex shrink-0 items-center gap-1">
                {state.cta && (
                  <Button
                    asChild
                    size="sm"
                    variant={state.tone === "action" ? "brand" : "outline"}
                  >
                    <Link href={state.cta.href}>{state.cta.label}</Link>
                  </Button>
                )}
                {!all && state.dismissable && (
                  <DismissScreeningInterview
                    id={interview.id}
                    jobTitle={interview.job_title}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return all ? (
    list
  ) : (
    <DashboardSection
      title="AI interviews"
      action={{ label: "See all", href: ALL_SCREENING_INTERVIEWS_PATH }}
    >
      {list}
    </DashboardSection>
  );
}
