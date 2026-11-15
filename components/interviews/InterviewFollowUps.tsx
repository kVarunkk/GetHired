import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import type { InterviewFollowUp } from "@/helpers/interviews/follow-ups";

/**
 * The dashboard's interview follow-ups (IVT-074): scorecards overdue (the
 * member's own first, linked to their kit) and self-scheduling links nobody
 * booked, linked to the application's Interviews section.
 */
export default function InterviewFollowUps({ items }: { items: InterviewFollowUp[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Interviews needing attention" className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Interviews needing attention</h4>
      <p className="text-sm text-muted-foreground">
        Scorecards not in a day after the interview, and scheduling links not booked after 3 days.
      </p>
      <ul className="divide-y rounded-xl border">
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.interviewId}`}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
          >
            <span>
              {item.mine ? (
                <>
                  <Link href={item.href} className="font-medium hover:underline">
                    Your scorecard for {item.interviewName}
                  </Link>
                  <span className="text-muted-foreground">
                    {` with ${item.candidateName} for ${item.jobTitle}`}
                  </span>
                </>
              ) : (
                <>
                  <Link href={item.href} className="font-medium hover:underline">
                    {item.candidateName}
                  </Link>
                  <span className="text-muted-foreground">{` · ${item.interviewName} for ${item.jobTitle}`}</span>
                </>
              )}
            </span>
            <span className="text-muted-foreground">{status(item)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function status(item: InterviewFollowUp): string {
  const since = formatDistanceToNow(new Date(item.since), { addSuffix: true });
  if (item.kind === "awaiting_candidate") return `Link sent ${since}, not booked`;
  if (item.mine) return `Ended ${since}`;
  return `${item.owed} scorecard${item.owed === 1 ? "" : "s"} overdue`;
}
