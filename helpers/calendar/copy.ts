// Copy for the calendar connection and scheduling (IVT-035–048). Client-safe.
// Names the missing permission, never a role (test/no-role-names-in-copy.test.ts).

export type CalendarConnectError =
  | "denied"
  | "scopes"
  | "admin_blocked"
  | "no_refresh"
  | "expired"
  | "mismatch"
  | "disabled"
  | "error";

export const CONNECT_ERRORS: Record<CalendarConnectError, string> = {
  denied: "You didn't allow access, so nothing was connected.",
  scopes:
    "GetHired needs both permissions: to see when you're busy and to manage the interview events it creates. Connect again and leave both ticked.",
  admin_blocked:
    "Your Google Workspace admin blocks third-party apps. Ask them to allow GetHired, then connect again.",
  no_refresh:
    "Google didn't give GetHired lasting access. Remove GetHired from your Google Account's third-party access page, then connect again.",
  expired: "Connecting took too long. Please try again.",
  mismatch: "You were signed in as someone else when Google sent you back. Please try again.",
  disabled: "Google Calendar isn't available yet.",
  error: "Couldn't connect your Google Calendar. Please try again.",
};

export const connectErrorMessage = (reason: string | null | undefined): string | null =>
  reason ? (CONNECT_ERRORS[reason as CalendarConnectError] ?? CONNECT_ERRORS.error) : null;

/** Booking and calendar-side changes (IVT-042–044). */
export const SCHEDULING_MESSAGES: Record<string, string> = {
  not_connected: "Connect your Google Calendar to book interviews.",
  organizer_reconnect: "Reconnect your Google Calendar to book interviews.",
  slot_taken: "That time was just taken. Pick another one.",
  calendar_failed: "Google Calendar didn't accept the booking. Nothing was scheduled. Please try again.",
  calendar_update_failed:
    "The interview was changed here, but Google Calendar couldn't be updated. Attendees weren't told.",
  organizer_disconnected:
    "The organizer's calendar is disconnected, so Google Calendar wasn't updated. Reschedule it to move it to your calendar.",
  organizer_disconnected_cancel:
    "The organizer's calendar is disconnected, so the Google Calendar event is still there. Ask them to delete it.",
  disabled: "Google Calendar isn't available yet.",
  // Self-scheduling links (IVT-060–065).
  panel_not_connected:
    "Everyone on the panel needs a connected Google Calendar for a scheduling link, so the link can show when they're free. Book a time or record it manually instead.",
  no_candidate_email:
    "This candidate can't get a scheduling link: they have no email address or they unsubscribed. Book a time or record it manually instead.",
  template_not_found: "Template not found.",
  needs_link: "Add {{scheduling_link}} to the message, so the candidate can pick a time.",
  daily_cap: "Your company has sent today's 300 emails. Try again tomorrow.",
  cap_unknown: "Couldn't check today's emails. Please try again.",
  email_failed: "The email couldn't be sent, so no link went out. Please try again.",
  invalid_token: "Something went wrong. Please try again.",
};

export const schedulingMessage = (reason: string) =>
  SCHEDULING_MESSAGES[reason] ?? "Something went wrong. Please try again.";
