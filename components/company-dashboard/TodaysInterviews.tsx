import { ClipboardList, Video } from "lucide-react";
import DashboardSection from "@/components/dashboard/DashboardSection";
import InterviewTime from "@/components/interviews/InterviewTime";
import { Button } from "@/components/ui/button";
import { kitPath } from "@/helpers/interviews/feedback-emails";
import type { MyInterview } from "@/helpers/interviews/my-interviews-view";
import TrackedLink from "./TrackedLink";

const track = (action: string) => ({ section: "todays_interviews", kind: "interview", action });

/**
 * CD-REQ-014: the member's own panel seats today and in the next 24 hours,
 * each with what to do: join, open the kit, or submit the scorecard once the
 * interview has ended.
 */
export default function TodaysInterviews({ interviews, now }: { interviews: MyInterview[]; now: Date }) {
  if (interviews.length === 0) return null;
  return (
    <DashboardSection title="Today's interviews" action={{ label: "View all", href: "/company/my-interviews" }}>
      <ul className="divide-y rounded-xl border">
        {interviews.map((interview) => {
          const ended = Boolean(interview.endsAt && Date.parse(interview.endsAt) <= now.getTime());
          const owesScorecard = ended && interview.scorecardStatus !== "submitted" && interview.kitOpen;
          return (
            <li
              key={interview.interviewId}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate font-medium">{interview.candidateName}</p>
                <p className="text-sm text-muted-foreground">
                  <InterviewTime startsAt={interview.startsAt} endsAt={interview.endsAt} />
                  {` · ${interview.name} for ${interview.jobTitle}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {owesScorecard ? (
                  <Button asChild size="sm" variant="brand">
                    <TrackedLink href={kitPath(interview.interviewId)} track={track("submit_scorecard")}>
                      Submit scorecard
                    </TrackedLink>
                  </Button>
                ) : (
                  <>
                    {interview.meetingUrl && !ended && (
                      <Button asChild size="sm" variant="outline">
                        <TrackedLink
                          href={interview.meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          track={track("join")}
                        >
                          <Video className="h-4 w-4" />
                          Join
                        </TrackedLink>
                      </Button>
                    )}
                    {interview.kitOpen && (
                      <Button asChild size="sm" variant="ghost">
                        <TrackedLink href={kitPath(interview.interviewId)} track={track("open_kit")}>
                          <ClipboardList className="h-4 w-4" />
                          Interview kit
                        </TrackedLink>
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </DashboardSection>
  );
}
