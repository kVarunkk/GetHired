// Client-safe: how "My interviews" sorts a member's interviews into tabs (IVT-021).

import type { Enums } from "@/utils/types/database.types";

export type MyInterview = {
  interviewId: string;
  applicationId: string;
  jobTitle: string;
  candidateName: string;
  name: string;
  status: Enums<"scheduled_interview_status">;
  startsAt: string | null;
  endsAt: string | null;
  meetingUrl: string | null;
  scorecardStatus: "none" | "draft" | "submitted";
  kitOpen: boolean;
};

export type MyInterviewTab = "upcoming" | "feedback" | "past";

/**
 * Upcoming: not over yet. Needs feedback: started, not cancelled or a no-show,
 * scorecard not submitted and the kit still open. Past: everything else.
 */
export function myInterviewTab(i: MyInterview, now: number): MyInterviewTab {
  const live = i.status === "scheduled" || i.status === "awaiting_candidate";
  if (live && (!i.endsAt || Date.parse(i.endsAt) > now) && (!i.startsAt || Date.parse(i.startsAt) > now)) {
    return "upcoming";
  }
  const scoring = i.status === "scheduled" || i.status === "completed";
  if (scoring && i.scorecardStatus !== "submitted" && i.kitOpen) return "feedback";
  return "past";
}
