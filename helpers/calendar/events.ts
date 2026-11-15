import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { deploymentUrl } from "@/utils/formatters";
import type { EventAttendee, EventInput } from "./provider";

// What a Google event for a scheduled interview holds (spec §4 "Using it").
// Read with the service role through interview_event_details, which hands
// out the candidate's address only when they're an attendee (D20).

type Admin = SupabaseClient<Database>;

export type EventPanelMember = { user_id: string; email: string | null; name: string | null; response: string };

export type EventDetails = {
  id: string;
  application_id: string;
  job_post_id: string;
  company_id: string;
  name: string;
  status: string;
  source: string;
  starts_at: string | null;
  ends_at: string | null;
  time_zone: string;
  meeting_url: string | null;
  provider_event_id: string | null;
  organizer_user_id: string | null;
  /** The organizer's active connection, or null when they're disconnected or gone (IV-REQ-023b). */
  organizer_connection_id: string | null;
  candidate_is_attendee: boolean;
  candidate_name: string | null;
  candidate_email: string | null;
  job_title: string | null;
  company_name: string | null;
  panel: EventPanelMember[];
};

export async function loadEventDetails(admin: Admin, interviewId: string): Promise<EventDetails | null> {
  const { data, error } = await admin.rpc("interview_event_details", { p_interview_id: interviewId });
  if (error) throw new Error(`Couldn't load the interview's event details: ${error.message}`);
  return (data as EventDetails | null) ?? null;
}

/** The panel, plus the candidate when they may be invited (D20). */
export function attendeesOf(details: EventDetails): EventAttendee[] {
  const panel = details.panel
    .filter((p): p is EventPanelMember & { email: string } => Boolean(p.email))
    .map((p) => ({ email: p.email, displayName: p.name }));
  const candidate =
    details.candidate_is_attendee && details.candidate_email
      ? [{ email: details.candidate_email, displayName: details.candidate_name }]
      : [];
  return [...panel, ...candidate];
}

/**
 * The event's text. The candidate sees it too, so it carries nothing
 * internal: no panel notes, no plan, no scorecards.
 */
export function eventInputOf(details: EventDetails): EventInput {
  const company = details.company_name ?? "GetHired";
  const job = details.job_title ? ` for ${details.job_title}` : "";
  return {
    interviewId: details.id,
    summary: `${details.name}: ${details.candidate_name ?? "Candidate"} and ${company}`,
    description: [
      `Interview${job} at ${company}, scheduled with GetHired.`,
      "Join with the Google Meet link on this invite.",
      `Interviewers: your interview kit is in GetHired under My interviews (${deploymentUrl()}/company/my-interviews).`,
    ].join("\n\n"),
    start: details.starts_at!,
    end: details.ends_at!,
    timeZone: details.time_zone,
    attendees: attendeesOf(details),
  };
}
