// Client-safe (IVT-073, IV-REQ-041): a board card's interview badges, from
// `job_interview_badges`. Times and counts only, never a rating.

export type MeetingBadge = {
  /** The next scheduled interview that hasn't started. */
  nextAt: string | null;
  /** Scorecards on recently completed interviews, while some are still owed. */
  feedback: { submitted: number; total: number } | null;
};

/** "Tue 14:00" in `zone` (the viewer's when omitted). */
export function badgeTime(iso: string, zone?: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: zone }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(date);
  return `${day} ${time}`;
}

/** The card's labels: the next interview first, then the feedback still owed. */
export function meetingBadges(meeting: MeetingBadge, zone?: string): string[] {
  const labels: string[] = [];
  if (meeting.nextAt) labels.push(`Interview ${badgeTime(meeting.nextAt, zone)}`);
  if (meeting.feedback) labels.push(`Feedback ${meeting.feedback.submitted}/${meeting.feedback.total}`);
  return labels;
}

/** One RPC row as a card's badge; null when there's nothing to show. */
export function meetingBadgeOf(row: {
  next_starts_at: string | null;
  feedback_submitted: number;
  feedback_total: number;
}): MeetingBadge | null {
  const feedback =
    row.feedback_submitted < row.feedback_total ? { submitted: row.feedback_submitted, total: row.feedback_total } : null;
  if (!row.next_starts_at && !feedback) return null;
  return { nextAt: row.next_starts_at, feedback };
}
