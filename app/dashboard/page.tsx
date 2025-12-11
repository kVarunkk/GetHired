import ErrorComponent from "@/components/Error";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TApplicationStatus } from "@/lib/types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import InfoTooltip from "@/components/InfoTooltip";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import { simpleTimeAgo } from "@/lib/serverUtils";
import { ArrowRight } from "lucide-react";
import RechargeCredits from "@/components/RechargeCredits";
import DashboardDropdown from "@/components/DashboardDropdown";
import CreditDepositDialog from "@/components/CreditDepositDialog";

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
        "full_name, email, ai_credits, updated_at, filled, invitations(*), invitations_count"
      )
      .eq("user_id", user.id)
      .single();

    if (userInfoError) throw error;
    const pendingCompleteInvitationDialogEmails = userInfoData.invitations
      .filter((each) => each.status === "complete" && !each.isDialogShown)
      .map((each) => each.invited_email);

    const [metricsRes, appliedJobsRes] = await Promise.all([
      supabase.rpc("get_applicant_weekly_metrics", { p_user_id: user.id }),
      supabase
        .from("applications")
        .select(
          "status, created_at, all_jobs!inner(id, job_name, company_name, platform, locations)"
        )
        .eq("applicant_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const { data: metricsData, error: metricsError } = metricsRes;
    const { data: appliedJobsData, error: appliedJobsError } = appliedJobsRes;

    if (metricsError) throw metricsError;
    if (appliedJobsError) throw appliedJobsError;

    const metrics = metricsData?.[0] || {};
    const jobPosts =
      appliedJobsData && appliedJobsData.length > 0
        ? appliedJobsData.map((each) => ({
            ...each.all_jobs,
            status: each.status,
            created_at: each.created_at,
          }))
        : [];

    return (
      <div className="flex flex-col w-full gap-5 mt-10">
        <div className="flex items-center justify-between flex-wrap gap-5">
          <h2 className="text-3xl font-medium text-start capitalize">
            How are you doing today,{" "}
            {userInfoData.full_name ?? userInfoData.email.split("@")[0]}?
          </h2>
          <Button asChild>
            <Link href={"/jobs"}>Find your next Job</Link>
          </Button>
          {/* <CreateJobPostingDialog company_id={companyInfo.id} /> */}
        </div>
        {/* --- Metrics Section --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="flex flex-col items-center p-6 text-center shadow-none hover:bg-secondary transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.applications_submitted_weekly || 0}
              </CardTitle>
              <p className="text-muted-foreground font-medium flex items-center gap-1">
                Applications Submitted
                <InfoTooltip
                  content="
                Number of Jobs you applied to in the past week.
                "
                />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center shadow-none hover:bg-secondary transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.status_updates_weekly || 0}
              </CardTitle>
              <p className="text-muted-foreground font-semibold flex items-center gap-1">
                Status Updates Received
                <InfoTooltip content="Number of application status updates you received from companies in the past week." />
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center shadow-none hover:bg-secondary transition-colors">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.jobs_favorited_weekly || 0}
              </CardTitle>
              <p className="text-muted-foreground font-semibold flex items-center gap-1">
                Jobs Favorited
                <InfoTooltip content="Number of Jobs you favorited in the past week." />
              </p>
            </CardContent>
          </Card>
        </div>

        {/* --- Active Job Posts Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-medium">Recently Applied Jobs</h3>
            <Link href={"/jobs?tab=applied"}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>

          {jobPosts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(
                jobPosts as unknown as {
                  id: string;
                  status: TApplicationStatus;
                  created_at: string;
                  job_name: string;
                  platform: string;
                  locations: string[];
                  company_name: string;
                }[]
              ).map((job) => (
                <Card key={job.id} className="p-4 shadow-none group">
                  <CardContent className="flex flex-col gap-2 p-0 h-full">
                    <Link
                      className="text-lg font-bold hover:underline underline underline-offset-4 sm:no-underline flex-1"
                      href={`/jobs/${job.id}`}
                      target="_blank"
                    >
                      {job.job_name}
                    </Link>
                    <div className="flex flex-col gap-2 ">
                      <ApplicationStatusBadge status={job.status} />
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <p>{job.company_name}</p>
                        <p>
                          Applied {simpleTimeAgo(job.created_at, "variant1")}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              You have no recently applied Jobs.{" "}
              <Link className="underline underline-offset-4" href={"/jobs"}>
                Find your next Job today
              </Link>
            </p>
          )}
        </div>

        {/* --- More Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-medium">More</h3>
            <DashboardDropdown />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="flex flex-col  p-4 text-center shadow-none  transition-colors">
              <CardHeader className="p-0"></CardHeader>
              <CardContent className="p-0 space-y-4 text-start flex flex-col justify-between h-full">
                <div className=" flex items-center gap-3 ">
                  <span className="text-4xl font-extrabold">
                    {userInfoData.ai_credits || 0}
                  </span>
                  <span className="text-muted-foreground font-medium">
                    AI Credits left
                  </span>
                </div>
                <RechargeCredits
                  user={user}
                  invitationsCount={userInfoData.invitations_count}
                />
              </CardContent>
            </Card>

            <Card className="flex flex-col  p-4 text-center shadow-none  transition-colors">
              {/* <CardHeader className="p-0"></CardHeader> */}
              <CardContent className="p-0 space-y-4 text-start flex flex-col justify-between h-full flex-1">
                <div className=" flex items-center gap-3 ">
                  {userInfoData.filled ? (
                    <span className="text-4xl font-extrabold">
                      {simpleTimeAgo(userInfoData.updated_at, "variant2") || 0}
                    </span>
                  ) : (
                    ""
                  )}
                  <span className="text-muted-foreground font-medium">
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
          </div>
        </div>

        {/* --- AI Credits Granted Dialog --- */}
        {pendingCompleteInvitationDialogEmails.length > 0 ? (
          <CreditDepositDialog
            userId={user.id}
            pendingDialogEmails={pendingCompleteInvitationDialogEmails}
          />
        ) : (
          ""
        )}
      </div>
    );
  } catch (e) {
    console.error(e);
    return <ErrorComponent />;
  }
}
