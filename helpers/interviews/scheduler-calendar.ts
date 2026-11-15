import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { LinkTemplate } from "./scheduling-schema";
import type { MemberCalendarStatus } from "./scheduling";

type Db = SupabaseClient<Database>;

export type InterviewsCalendarView = {
  /** The session member's own connection; null when they never connected. */
  own: "active" | "error" | null;
  /** `panel_calendar_status` by user id: empty without scheduling.manage. */
  statuses: Record<string, MemberCalendarStatus>;
  /** D20: whether a booking would invite the candidate. */
  candidateInvitable: boolean;
};

const asStatus = (s: string): MemberCalendarStatus => (s === "connected" || s === "error" ? s : "unknown");

/**
 * What the Interviews section needs about calendars (IVT-045, IVT-048): the
 * panel picker's badges, the organizers' state for the banners, the member's
 * own connection and the D20 notice. All through the session's client.
 */
export async function loadInterviewsCalendar(
  supabase: Db,
  { jobId, applicationId, userId, userIds }: { jobId: string; applicationId: string; userId: string; userIds: string[] },
): Promise<InterviewsCalendarView> {
  const ids = [...new Set([...userIds, userId])];
  const [statusRes, ownRes, invitableRes] = await Promise.all([
    supabase.rpc("panel_calendar_status", { p_job_post_id: jobId, p_user_ids: ids }),
    supabase.from("calendar_connections").select("status").eq("user_id", userId).eq("provider", "google").maybeSingle(),
    supabase.rpc("interview_candidate_invitable", { p_application_id: applicationId }),
  ]);
  const statuses: Record<string, MemberCalendarStatus> = {};
  for (const row of statusRes.data ?? []) statuses[row.user_id] = asStatus(row.status);
  const own = ownRes.data ? (ownRes.data.status === "error" ? "error" : "active") : null;
  return { own, statuses, candidateInvitable: invitableRes.data === true };
}

const LINK_PURPOSES = ["interview_invite", "custom"] as const;

/**
 * The templates a scheduling link can go out with (IVT-065): interview
 * invites first, the default one on top, then custom ones. The send checks
 * the template again; a read failure just means none to offer.
 */
export async function loadLinkTemplates(supabase: Db, companyId: string): Promise<LinkTemplate[]> {
  const { data, error } = await supabase
    .from("company_email_templates")
    .select("id, purpose, name, subject, body_md, is_default")
    .eq("company_id", companyId)
    .in("purpose", [...LINK_PURPOSES]);
  if (error || !data) return [];
  const rank = (t: (typeof data)[number]) => (t.purpose === "interview_invite" ? (t.is_default ? 0 : 1) : 2);
  return [...data]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body_md }));
}
