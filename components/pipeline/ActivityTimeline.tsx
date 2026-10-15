import { formatDistanceToNow } from "date-fns";
import type { Tables } from "@/utils/types/database.types";

type Event = Tables<"application_events">;
type Payload = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : null);
const by = (event: Event) => (event.actor_name ? ` by ${event.actor_name}` : "");

/** One line per event type; null skips an unknown type. */
function describe(event: Event, stageName: (id: unknown) => string): string | null {
  const payload = (event.payload ?? {}) as Payload;
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
    default:
      return null;
  }
}

/**
 * The applicant page's Activity tab (PL-TASK-021, PL-REQ-005): the
 * application's events, newest first. Stage names come from `stages`
 * (archived ones included), so a renamed stage shows its current name.
 */
export default function ActivityTimeline({
  events,
  stages,
}: {
  events: Event[];
  stages: { id: string; name: string }[];
}) {
  const names = new Map(stages.map((s) => [s.id, s.name]));
  const stageName = (id: unknown) => (typeof id === "string" && names.get(id)) || "a removed stage";

  const lines = events
    .map((event) => ({ event, line: describe(event, stageName) }))
    .filter((e): e is { event: Event; line: string } => e.line !== null)
    .sort((a, b) => b.event.created_at.localeCompare(a.event.created_at));

  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="flex flex-col gap-3 border-l pl-4">
      {lines.map(({ event, line }) => (
        <li key={event.id} className="text-sm">
          <p>{line}</p>
          <time dateTime={event.created_at} className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </time>
        </li>
      ))}
    </ol>
  );
}
