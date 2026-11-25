import type { Metadata } from "next";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import CreditDepositDialog from "@/components/CreditDepositDialog";
import AskApplicantAgent from "@/components/agent/AskApplicantAgent";
import MyScreeningInterviews from "@/components/interviews/MyScreeningInterviews";
import MyScheduledInterviews from "@/components/interviews/MyScheduledInterviews";
import NeedsAttention from "@/components/dashboard/NeedsAttention";
import PipelineCard from "@/components/dashboard/PipelineCard";
import RecommendedJobs from "@/components/dashboard/RecommendedJobs";
import SavedToApply from "@/components/dashboard/SavedToApply";
import ProfileChecklist from "@/components/dashboard/ProfileChecklist";
import JobAlertsCard from "@/components/dashboard/JobAlertsCard";
import AccountStrip from "@/components/dashboard/AccountStrip";
import { createClient } from "@/lib/supabase/server";
import { loadRecommendedJobs, type RecommendedJobs as Recommended } from "@/helpers/dashboard/recommended-jobs";
import { dashboardSuggestions } from "@/helpers/dashboard/suggestions";
import {
  attentionItems,
  dashboardHeadline,
  pipelineOf,
  profileProgress,
  savedNotApplied,
} from "@/helpers/dashboard/summary";
import { listMyScreeningInterviews } from "@/helpers/interview/screening/my-interviews";
import { screeningCardState, visibleOnDashboard } from "@/helpers/interview/screening/dashboard-state";
import { listMyScheduledInterviews } from "@/helpers/interviews/my-scheduled-interviews";
import { listJobAlerts } from "@/helpers/job-alerts/writes";
import { requireAlertSession } from "@/helpers/job-alerts/session";
import { PROFILE_VIEW_WINDOW_DAYS } from "@/helpers/outreach/config";
import { listMyApplications } from "@/helpers/tracker/list-my-applications";
import { listMySavedJobs } from "@/helpers/tracker/list-my-saved";
import type { SavedJobItem } from "@/helpers/tracker/types";
import { simpleTimeAgo } from "@/utils/date";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "What needs you today, where your applications stand, and jobs matched to you.",
  robots: { index: false, follow: false },
};

/** "today", "yesterday" or "N days ago" since the profile was last saved. */
function updatedAgo(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const days = Number(simpleTimeAgo("variant2", updatedAt));
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The applicant dashboard: what needs the user today (interviews, follow-ups,
 * replies), their pipeline, matched and saved jobs to apply to, their profile
 * and alerts. Account housekeeping sits in one row under the matched jobs.
 */
export default async function DashboardPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");
    const ctx = { supabase, user: { id: user.id } };

    const { data: userInfoData, error: userInfoError } = await supabase
      .from("user_info")
      .select(
        "full_name, email, ai_credits, updated_at, filled, invitations(*), invitations_count, payments(id), relevant_jobs_update_status, relevance_started_at, desired_roles, top_skills, preferred_locations, min_salary, max_salary, experience_years, linkedin_url, github_url",
      )
      .eq("user_id", user.id)
      .single();

    if (userInfoError) throw userInfoError;
    const pendingCompleteInvitationDialogEmails = userInfoData.invitations
      .filter((each) => each.status === "complete" && !each.isDialogShown && each.invited_email)
      .map((each) => each.invited_email)
      .filter((email): email is string => email !== null);

    // Applications are the page; everything else is an extra whose failure hides it.
    const applicationsP = listMyApplications(ctx);
    const savedP = listMySavedJobs(ctx).catch((): SavedJobItem[] => []);
    const recommendedP: Promise<Recommended | null> = Promise.all([applicationsP, savedP])
      .then(([applications, saved]) => {
        const exclude = new Set(
          [...applications, ...saved].map((item) => item.allJobsId).filter((id): id is string => Boolean(id)),
        );
        return loadRecommendedJobs(ctx, { profile: userInfoData, exclude });
      })
      .catch(() => null);
    const alertsP = requireAlertSession()
      .then((session) => (session.ok ? listJobAlerts(session.ctx) : null))
      .catch(() => null);

    // Its own query so a missing column (migration not pushed yet) only hides the goal.
    const weeklyGoalP = Promise.resolve(
      supabase.from("user_info").select("weekly_application_goal").eq("user_id", user.id).maybeSingle(),
    )
      .then(({ data }) => data?.weekly_application_goal ?? null)
      .catch(() => null);

    const [
      applications,
      saved,
      recommended,
      alerts,
      viewsRes,
      resumeRes,
      screeningInterviews,
      scheduledInterviews,
      weeklyGoal,
    ] = await Promise.all([
        applicationsP,
        savedP,
        recommendedP,
        alertsP,
        supabase.rpc("get_my_profile_view_count", { p_days: PROFILE_VIEW_WINDOW_DAYS }),
        supabase
          .from("resumes")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_primary", true),
        listMyScreeningInterviews(supabase),
        listMyScheduledInterviews(supabase),
        weeklyGoalP,
      ]);

    const now = new Date();
    const profileViews = viewsRes.error ? 0 : (viewsRes.data ?? 0);
    const attention = attentionItems(applications, now);
    const pipeline = pipelineOf(applications, now);
    const readyToApply = savedNotApplied(saved, applications, saved.length);
    const progress = profileProgress({ ...userInfoData, hasResume: (resumeRes.count ?? 0) > 0 });
    const screeningToDo = screeningInterviews.filter(
      (interview) => visibleOnDashboard(interview, now) && screeningCardState(interview, now).tone === "action",
    ).length;
    const nextInterview = scheduledInterviews.find((interview) => interview.status !== "awaiting_candidate") ?? null;
    const topJob = recommended?.state === "ready" ? (recommended.jobs[0] ?? null) : null;

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <PageHeader
          title={
            <span className="capitalize">
              How are you doing today, {userInfoData.full_name ?? userInfoData.email?.split("@")[0]}?
            </span>
          }
          description={dashboardHeadline({
            attention,
            scheduledInterviews: scheduledInterviews.length,
            screeningInterviews: screeningToDo,
          })}
        />

        <AskApplicantAgent
          suggestions={dashboardSuggestions({
            attention,
            nextInterview: nextInterview && {
              interviewName: nextInterview.interview_name,
              jobTitle: nextInterview.job_title,
              companyName: nextInterview.company_name,
            },
            topJob,
          })}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
            <MyScheduledInterviews interviews={scheduledInterviews} />
            <MyScreeningInterviews interviews={screeningInterviews} now={now} />
            <NeedsAttention items={attention} />
            {recommended && <RecommendedJobs recommended={recommended} />}
            <AccountStrip
              user={user}
              credits={userInfoData.ai_credits || 0}
              invitationsCount={userInfoData.invitations_count}
              hasPurchases={userInfoData.payments.length > 0}
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-6" aria-label="Your search at a glance">
            <PipelineCard pipeline={pipeline} weeklyGoal={weeklyGoal} />
            <SavedToApply items={readyToApply.slice(0, 3)} total={readyToApply.length} />
            <ProfileChecklist
              filled={userInfoData.filled}
              progress={progress}
              profileViews={profileViews}
              lastUpdated={updatedAgo(userInfoData.updated_at)}
            />
            <JobAlertsCard alerts={alerts} />
          </aside>
        </div>

        {pendingCompleteInvitationDialogEmails.length > 0 && (
          <CreditDepositDialog pendingDialogEmails={pendingCompleteInvitationDialogEmails} />
        )}
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
