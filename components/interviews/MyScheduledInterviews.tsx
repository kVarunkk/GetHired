"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { openMySchedulingLinkAction } from "@/app/actions/interviews/open-my-scheduling-link";
import type { MyScheduledInterview } from "@/helpers/interviews/my-scheduled-interviews";
import InterviewTime from "./InterviewTime";

/**
 * The dashboard's interviews with people (IVT-064, IV-REQ-043): the time,
 * the meeting link, and a way to pick or move the time when the company sent
 * a scheduling link. Interviewers and feedback aren't shown.
 */
export default function MyScheduledInterviews({ interviews }: { interviews: MyScheduledInterview[] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (interviews.length === 0) return null;

  const open = async (id: string) => {
    setOpening(id);
    try {
      const result = await openMySchedulingLinkAction({ interviewId: id });
      if (result.ok) window.location.assign(result.path);
      else toast.error(result.error);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">Upcoming interviews</h2>
      <ul className="divide-y rounded-xl border">
        {interviews.map((interview) => {
          const waiting = interview.status === "awaiting_candidate";
          return (
            <li
              key={interview.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-medium">{interview.interview_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {interview.job_title} · {interview.company_name}
                  </p>
                  <p className="text-sm">
                    {waiting ? (
                      `Pick a time for this ${interview.duration_minutes}-minute interview.`
                    ) : (
                      <InterviewTime startsAt={interview.starts_at} endsAt={interview.ends_at} />
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!waiting && interview.meeting_url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={interview.meeting_url} target="_blank" rel="noopener noreferrer">
                      Join
                    </a>
                  </Button>
                )}
                {interview.can_reschedule && (
                  <Button
                    size="sm"
                    variant={waiting ? "brand" : "ghost"}
                    disabled={opening !== null}
                    onClick={() => open(interview.id)}
                  >
                    {opening === interview.id ? "Opening…" : waiting ? "Pick a time" : "Reschedule"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
