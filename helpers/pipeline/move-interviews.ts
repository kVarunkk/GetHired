// Client-safe (IVT-071): how a move's approval card and MCP confirmation
// describe the upcoming interviews a move to Rejected or Hired cancels or keeps.

export function upcomingInterviewsText({ upcoming, cancel }: { upcoming: number; cancel: boolean }): string {
  const what = `${upcoming} upcoming interview${upcoming === 1 ? "" : "s"}`;
  return cancel
    ? `Cancels ${what}: links stop working, and Google Calendar tells the attendees.`
    : `Keeps ${what}.`;
}
