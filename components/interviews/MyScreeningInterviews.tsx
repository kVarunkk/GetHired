import Link from "next/link";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";
import { screeningCardState, visibleOnDashboard } from "@/helpers/interview/screening/dashboard-state";
import type { MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";

/** The dashboard's AI interviews: status, deadline and what to do next (SIT-054). */
export default function MyScreeningInterviews({
  interviews,
  now = new Date(),
}: {
  interviews: MyScreeningInterview[];
  now?: Date;
}) {
  const visible = interviews.filter((interview) => visibleOnDashboard(interview, now));
  if (visible.length === 0) return null;

  return (
    <section className="mt-8">
      <h3 className="mb-4 text-lg font-semibold tracking-tight">AI interviews</h3>
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
                  <p className="text-sm text-muted-foreground">{interview.company_name}</p>
                  <p
                    className={cn(
                      "text-sm",
                      state.tone === "action" ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {state.label}
                  </p>
                </div>
              </div>
              {state.cta && (
                <Button asChild size="sm" variant={state.tone === "action" ? "brand" : "outline"} className="shrink-0">
                  <Link href={state.cta.href}>{state.cta.label}</Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
