"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/utils";
import { badgeTime, type MeetingBadge } from "@/helpers/interviews/board-badge";

/**
 * A board card's interviews with people (IVT-073): "Interview Tue 14:00" and
 * "Feedback 1/3". The server renders the time in UTC (it doesn't know the
 * viewer's zone), then the browser swaps in local time.
 */
export default function MeetingBadges({ meeting, className }: { meeting: MeetingBadge; className?: string }) {
  const [time, setTime] = useState(() => (meeting.nextAt ? badgeTime(meeting.nextAt, "UTC") : null));
  useEffect(() => {
    if (meeting.nextAt) setTime(badgeTime(meeting.nextAt));
  }, [meeting.nextAt]);

  return (
    <>
      {meeting.nextAt && time && (
        <Badge variant="outline" title="Next interview" className={cn("gap-1 font-normal", className)}>
          <CalendarClock className="h-3 w-3" aria-hidden />
          <time dateTime={meeting.nextAt}>{`Interview ${time}`}</time>
        </Badge>
      )}
      {meeting.feedback && (
        <Badge variant="outline" title="Scorecards submitted" className={cn("gap-1 font-normal", className)}>
          <ClipboardCheck className="h-3 w-3" aria-hidden />
          <span>{`Feedback ${meeting.feedback.submitted}/${meeting.feedback.total}`}</span>
        </Badge>
      )}
    </>
  );
}
