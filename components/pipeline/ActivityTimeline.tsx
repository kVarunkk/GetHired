import { formatDistanceToNow } from "date-fns";
import type { Tables } from "@/utils/types/database.types";
import MemberAvatar from "@/components/team/MemberAvatar";
import { RATING_LABELS, type CandidateRating } from "@/helpers/pipeline/ratings";

type Event = Tables<"application_events">;
type Payload = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : null);
const by = (event: Event) => (event.actor_name ? ` by ${event.actor_name}` : "");

/** One line per event type; null skips an unknown type. */
function describe(
  event: Event,
  stageName: (id: unknown) => string,
  overallOf: (scorecardId: unknown) => CandidateRating | null,
): string | null {
  const payload = (event.payload ?? {}) as Payload;
  const interview = text(payload.name) ?? "Interview";
  switch (event.type) {
    case "applied":
      return "Applied";
    case "stage_changed":
      return `Moved from ${stageName(payload.from_stage_id)} to ${stageName(payload.to_stage_id)}${by(event)}`;
    case "email_sent": {
      const subject = text(payload.subject);
      return `Emailed ${subject ? `"${subject}"` : "the candidate"}${by(event)}`;
    }
    case "note_added":
      return `Note added${by(event)}${payload.rated ? ", with a rating" : ""}`;
    case "screened":
      return typeof payload.fit_score === "number"
        ? `Screened: fit score ${payload.fit_score}`
        : "Screened";
    case "outreach_sent":
      return `Outreach sent${by(event)}`;
    case "outreach_replied":
      return "Replied to outreach";
    // BI-REQ-030/040/042: company candidates.
    case "imported":
      return `Imported${by(event)}`;
    case "claimed":
      return "Joined GetHired with this email";
    case "merged":
      return "Merged with their own application";
    // IV-REQ-042: interviews with people.
    case "meeting_scheduled":
      return payload.status === "completed"
        ? `${interview} recorded${by(event)}`
        : `${interview} scheduled${by(event)}`;
    case "meeting_rescheduled":
      return `${interview} rescheduled${by(event)}`;
    case "meeting_panel_changed":
      return `${interview}: interviewers changed${by(event)}`;
    case "meeting_cancelled":
      return `${interview} cancelled${by(event)}`;
    case "meeting_completed":
      return `${interview} completed${by(event)}`;
    case "meeting_no_show":
      return `${interview}: candidate didn't show${by(event)}`;
    case "scorecard_submitted": {
      // The event never carries the recommendation; it comes from the
      // scorecards the reader may see (IV-REQ-032).
      const overall = overallOf(payload.scorecard_id);
      return `Scorecard submitted for ${interview}${by(event)}${overall ? `: ${RATING_LABELS[overall]}` : ""}`;
    }
    default:
      return null;
  }
}

/**
 * The applicant page's Activity tab (PL-TASK-021, PL-REQ-005): the
 * application's events, newest first. Stage names come from `stages`
 * (archived ones included), so a renamed stage shows its current name.
 * `scorecardOveralls` maps a scorecard id to its recommendation, only for
 * scorecards the reader may see (from `list_interview_scorecards`, which
 * applies blind review); the others show without one.
 */
export default function ActivityTimeline({
  events,
  stages,
  scorecardOveralls = {},
}: {
  events: Event[];
  stages: { id: string; name: string }[];
  scorecardOveralls?: Record<string, CandidateRating>;
}) {
  const names = new Map(stages.map((s) => [s.id, s.name]));
  const stageName = (id: unknown) => (typeof id === "string" && names.get(id)) || "a removed stage";
  const overallOf = (id: unknown) => (typeof id === "string" && scorecardOveralls[id]) || null;

  const lines = events
    .map((event) => ({ event, line: describe(event, stageName, overallOf) }))
    .filter((e): e is { event: Event; line: string } => e.line !== null)
    .sort((a, b) => b.event.created_at.localeCompare(a.event.created_at));

  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="flex flex-col gap-3 border-l pl-4">
      {lines.map(({ event, line }) => (
        <li key={event.id} className="flex items-start gap-2 text-sm">
          {/* TM-REQ-008: who did it, from the name stored on the event. */}
          {event.actor_name && <MemberAvatar name={event.actor_name} className="h-6 w-6 text-[10px]" />}
          <div>
            <p>{line}</p>
            <time dateTime={event.created_at} className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
