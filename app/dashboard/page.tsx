import { myJobsPath } from "@/helpers/tracker/paths";
import ErrorComponent from "@/components/Error";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { appliedAgo, newestApplications } from "@/helpers/tracker/card";
import { listMyApplications } from "@/helpers/tracker/list-my-applications";
import { trackedApplicationPath } from "@/helpers/tracker/paths";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import InfoTooltip from "@/components/InfoTooltip";
import { simpleTimeAgo } from "@/utils/date";
import { ArrowRight } from "lucide-react";
import RechargeCredits from "@/components/RechargeCredits";
import DashboardDropdown from "@/components/DashboardDropdown";
import CreditDepositDialog from "@/components/CreditDepositDialog";
import ProfileViewsCard from "@/components/ProfileViewsCard";
import McpConnectCard from "@/components/mcp/McpConnectCard";
import { PROFILE_VIEW_WINDOW_DAYS } from "@/helpers/outreach/config";
import AskApplicantAgent from "@/components/agent/AskApplicantAgent";
import PageHeader from "@/components/PageHeader";
import MyScreeningInterviews from "@/components/interviews/MyScreeningInterviews";
import { listMyScreeningInterviews } from "@/helpers/interview/screening/my-interviews";
import MyScheduledInterviews from "@/components/interviews/MyScheduledInterviews";
import { listMyScheduledInterviews } from "@/helpers/interviews/my-scheduled-interviews";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your applications, saved jobs and AI-matched openings.",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: userInfoData, error: userInfoError } = await supabase
      .from("user_info")
      .select(
        "full_name, email, ai_credits, updated_at, filled, invitations(*), invitations_count, payments(id)",
      )
      .eq("user_id", user.id)
      .single();

    if (userInfoError) throw error;
    const pendingCompleteInvitationDialogEmails = userInfoData.invitations
      .filter(
        (each) =>
          each.status === "complete" &&
          !each.isDialogShown &&
          each.invited_email,
      )
      .map((each) => each.invited_email)
      .filter((email): email is string => email !== null);

    const [metricsRes, appliedJobsRes, viewsRes, screeningInterviews, scheduledInterviews] = await Promise.all([
      supabase.rpc("get_applicant_weekly_metrics", { p_user_id: user.id }),
      // Applications from GetHired and tracked ones, as My Jobs shows them (AT-REQ-024).
      listMyApplications({ supabase, user: { id: user.id } })
        .then((items) => ({ data: newestApplications(items, 3), error: null }))
        .catch((error: Error) => ({ data: null, error })),
      supabase.rpc("get_my_profile_view_count", { p_days: PROFILE_VIEW_WINDOW_DAYS }),
      // An extra too: a failure reads as no interviews.
      listMyScreeningInterviews(supabase),
      // IV-REQ-043: interviews with people, through my_scheduled_interviews() only.
      listMyScheduledInterviews(supabase),
    ]);

    const { data: metricsData, error: metricsError } = metricsRes;
    const { data: appliedJobsData, error: appliedJobsError } = appliedJobsRes;

    if (metricsError) throw metricsError;
    if (appliedJobsError) throw appliedJobsError;

    // The view count is an extra: a failure hides it, not the page.
    const profileViews = viewsRes.error ? 0 : (viewsRes.data ?? 0);

    const metrics = metricsData?.[0] || {};
    const recentApplications = appliedJobsData ?? [];

    return (
      <div className="flex flex-col w-full gap-5 mb-20 p-4">
        <PageHeader
          title={
            <span className="capitalize">
              How are you doing today,{" "}
              {userInfoData.full_name ?? userInfoData.email?.split("@")[0]}?
            </span>
          }
        />

        <AskApplicantAgent />

        {/* --- Metrics Section --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="flex flex-col items-center p-6 text-center hover:bg-muted/60 transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.applications_submitted_weekly || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-1">
                Applications Submitted
                <InfoTooltip
                  content="
                Number of Jobs you applied to in the past week.
                "
                />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center hover:bg-muted/60 transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.status_updates_weekly || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-1">
                Status Updates Received
                <InfoTooltip content="Number of application status updates you received from companies in the past week." />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center hover:bg-muted/60 transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.jobs_favorited_weekly || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-1">
                Jobs Favorited
                <InfoTooltip content="Number of Jobs you favorited in the past week." />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center hover:bg-muted/60 transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.resumes_created_weekly || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-1">
                Resumes Created
                <InfoTooltip content="Number of resumes you have created in the past week." />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center hover:bg-muted/60 transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.resume_reviews_created_weekly || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium flex items-center gap-1">
                Resumes Analyzed
                <InfoTooltip content="Number of resumes you have analyzed in the past week." />
              </p>
            </CardContent>
          </Card>
        </div>

        <MyScheduledInterviews interviews={scheduledInterviews} />

        <MyScreeningInterviews interviews={screeningInterviews} />

        {/* --- Active Job Posts Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tight">
              Recently Applied Jobs
            </h3>
            <Link href={myJobsPath({ tab: "applications" })}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>

          {recentApplications.length > 0 ? (
            <ul className="divide-y rounded-xl border">
              {recentApplications.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      className="font-medium underline underline-offset-4 transition-colors hover:text-brand sm:no-underline"
                      href={trackedApplicationPath(item.id)}
                    >
                      {item.jobTitle}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {item.companyName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                    <Badge variant="outline" className="font-normal">
                      {item.statusLabel}
                    </Badge>
                    <p>{appliedAgo(item.appliedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              You have no recently applied Jobs.{" "}
              <Link
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand"
                href={"/jobs"}
              >
                Find your next Job today
              </Link>
            </p>
          )}
        </div>

        {/* --- More Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tight">More</h3>
            <DashboardDropdown />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="flex flex-col p-4 text-center">
              <CardHeader className="p-0"></CardHeader>
              <CardContent className="p-0 space-y-4 text-start flex flex-col justify-between h-full">
                <div className=" flex items-center gap-3 ">
                  <span className="text-3xl font-semibold tracking-tight">
                    {userInfoData.ai_credits || 0}
                  </span>
                  <span className="text-sm text-muted-foreground font-medium">
                    AI Credits left
                  </span>
                </div>
                <RechargeCredits
                  user={user}
                  invitationsCount={userInfoData.invitations_count}
                />
              </CardContent>
            </Card>

            <Card className="flex flex-col p-4 text-center">
              {/* <CardHeader className="p-0"></CardHeader> */}
              <CardContent className="p-0 space-y-4 text-start flex flex-col justify-between h-full flex-1">
                <div className=" flex items-center gap-3 ">
                  {userInfoData.filled ? (
                    <span className="text-3xl font-semibold tracking-tight">
                      {simpleTimeAgo("variant2", userInfoData.updated_at) || 0}
                    </span>
                  ) : (
                    ""
                  )}
                  <span className="text-sm text-muted-foreground font-medium">
                    {userInfoData.filled
                      ? "Days since the last Profile Update"
                      : "You've not completed your Profile. Please complete to use AI features."}
                  </span>
                </div>
                <Button asChild>
                  <Link href={"/get-started"}>
                    {userInfoData.filled
                      ? "Update Profile"
                      : "Complete Profile"}{" "}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col p-4 text-center">
              {/* <CardHeader className="p-0"></CardHeader> */}
              <CardContent className="p-0 space-y-4 text-start flex flex-col justify-between h-full flex-1">
                <div className=" flex items-center gap-3 ">
                  <span className="text-3xl font-semibold tracking-tight">
                    {userInfoData.payments.length}
                  </span>

                  <span className="text-sm text-muted-foreground font-medium">
                    AI Credits purchases made
                  </span>
                </div>
                <Button asChild>
                  <Link href={"/dashboard/buy-credits/payments"}>
                    View Purchase History
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <McpConnectCard />

            <ProfileViewsCard count={profileViews} />
          </div>
        </div>

        {/* --- AI Credits Granted Dialog --- */}
        {pendingCompleteInvitationDialogEmails.length > 0 ? (
          <CreditDepositDialog
            pendingDialogEmails={pendingCompleteInvitationDialogEmails}
          />
        ) : (
          ""
        )}
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
