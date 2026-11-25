import "server-only";
import type { TrackedRow, TrackerContext } from "./context";
import { listMyApplications } from "./list-my-applications";
import type { TrackedStatus } from "./status";
import type { TrackerItem } from "./types";

export type TimelineEvent = { id: string; kind: string; fromStatus: TrackedStatus | null; toStatus: TrackedStatus; createdAt: string };

export type TrackerDetail =
  | { kind: "tracked"; row: TrackedRow & { all_jobs: { status: string } | null }; events: TimelineEvent[] }
  | { kind: "gethired"; item: TrackerItem };

/**
 * A card's page (AT-REQ-023). The id is a tracked row's or a GetHired
 * `applications.id`; both are read as the session user, so an id that isn't
 * theirs is `null` and the page answers 404.
 */
export async function loadTrackerDetail(ctx: TrackerContext, id: string): Promise<TrackerDetail | null> {
  const { supabase, user } = ctx;
  const { data: row, error } = await supabase
    .from("tracked_applications")
    .select("*, all_jobs ( status )")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  if (row) {
    const { data: events, error: eventsError } = await supabase
      .from("tracked_application_events")
      .select("id, kind, from_status, to_status, created_at")
      .eq("tracked_application_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (eventsError) throw eventsError;
    return {
      kind: "tracked",
      row,
      events: (events ?? []).map((event) => ({
        id: event.id,
        kind: event.kind,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        createdAt: event.created_at,
      })),
    };
  }

  const item = (await listMyApplications(ctx)).find((each) => each.id === id && each.kind === "gethired");
  return item ? { kind: "gethired", item } : null;
}
