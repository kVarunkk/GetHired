import type { Metadata } from "next";
import { after } from "next/server";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import Streamed from "@/components/Streamed";
import { AskBoxSkeleton, CardSkeleton, TitledListSkeleton } from "@/components/skeletons";
import AskRecruiterAgent from "@/components/agent/recruiter/AskRecruiterAgent";
import { AGENT_ROLE_UI } from "@/components/agent/roles";
import CareersCard from "@/components/company-dashboard/CareersCard";
import CompanyNeedsAttention from "@/components/company-dashboard/CompanyNeedsAttention";
import CompanyPipelineCard from "@/components/company-dashboard/CompanyPipelineCard";
import NewApplications from "@/components/company-dashboard/NewApplications";
import OpenJobsCard from "@/components/company-dashboard/OpenJobsCard";
import PoolMatchesCard from "@/components/company-dashboard/PoolMatchesCard";
import SetupChecklist from "@/components/company-dashboard/SetupChecklist";
import TodaysInterviews from "@/components/company-dashboard/TodaysInterviews";
import UsageCard from "@/components/company-dashboard/UsageCard";
import McpConnectLink from "@/components/dashboard/McpConnectLink";
import { CreateJobPostButton } from "@/components/jobs/JobPostButtons";
import { RECRUITER_TOOL_PERMISSIONS } from "@/helpers/agent/roles/recruiter/tools/permissions";
import {
  loadAttentionJobs,
  loadCompanyProfile,
  loadDashboardSummary,
  loadMoveData,
  loadNewApplications,
  loadNewJobs,
  loadOpenJobs,
  loadOutreachReplies,
  loadPoolSection,
  loadResendTemplateId,
  loadScreenings,
  loadSetupFacts,
  loadTodaysInterviews,
  loadUsage,
  section,
  type DashboardCtx,
} from "@/helpers/company-dashboard/load";
import { companyDashboardSuggestions } from "@/helpers/company-dashboard/suggestions";
import {
  ATTENTION_KINDS,
  companyAttentionItems,
  companyDashboardHeadline,
  companySetupProgress,
  couldHaveAttention,
} from "@/helpers/company-dashboard/summary";
import { canViewBilling } from "@/helpers/billing/access";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { NO_MEMBERSHIP } from "@/helpers/companies/require-company";
import { todayIn } from "@/helpers/companies/time-zone";
import { loadInterviewFollowUps } from "@/helpers/interviews/follow-ups";
import { firstName } from "@/helpers/outreach/linkify";
import { getCompanyFunnel } from "@/helpers/pipeline/funnel";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { createClient } from "@/lib/supabase/server";
import { PostHogEvent } from "@/utils/types";

export const metadata: Metadata = {
  title: "Company Dashboard",
  description: "What needs you today: interviews, applicants waiting, and your hiring at a glance.",
};

/**
 * The company dashboard (plan/company-dashboard): what needs the member today
 * (interviews, scorecards, applicants and jobs waiting), and their hiring at a
 * glance. Each section follows the member's permissions and job scope, and
 * only the summary can fail the page. What the headline and "Needs attention"
 * don't use streams in after them.
 */
export default async function CompanyPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const company = await getMyCompany(supabase, user);
    if (!company) {
      // Onboarded but no membership: removed from their company (teams
      // difference 14). A new invite works, since the account is free again.
      if (user.app_metadata?.onboarding_complete) {
        return (
          <div className="mx-auto w-full max-w-md p-4 py-12">
            <div className="rounded-xl border p-6">
              <h1 className="text-2xl font-semibold tracking-tight">No company</h1>
              <p className="mt-3 text-sm text-muted-foreground">{NO_MEMBERSHIP}</p>
            </div>
          </div>
        );
      }
      throw new Error("Company profile not found");
    }

    const now = new Date();
    const ctx: DashboardCtx = { supabase, company, userId: user.id, now };
    // CD-REQ-032: a section the member can't see isn't loaded.
    const viewsApplicants = canAny(company, "applicants.view");
    const viewsJobs = canAny(company, "jobs.view");

    // CD-REQ-037: everything starts together. What reads the company's time
    // zone waits only for that, and the pool counts for the new jobs.
    const summaryP = loadDashboardSummary(supabase);
    const profileP = section("the company profile", () => loadCompanyProfile(ctx));
    const funnelP = viewsApplicants
      ? section("the funnel", () => getCompanyFunnel({ supabase, company }, now))
      : Promise.resolve(null);
    const newJobsP = section("the new jobs", () => loadNewJobs(ctx));
    const poolP = newJobsP.then((newJobs) => section("the pool matches", () => loadPoolSection(ctx, newJobs ?? [])));
    const moveP = funnelP.then((funnel) =>
      section("the pipeline stages", () => loadMoveData(ctx, funnel?.needsAttention ?? [])),
    );
    const followUpsP = section("the interview follow-ups", () => loadInterviewFollowUps(supabase));
    // These stream in (the pool matches are vector searches). `section` never rejects.
    const newApplicationsP = viewsApplicants
      ? section("the new applications", () => loadNewApplications(ctx))
      : Promise.resolve(null);
    const openJobsP = viewsJobs ? section("the open jobs", () => loadOpenJobs(ctx)) : Promise.resolve(null);
    const usageP = section("the plan and usage", () => loadUsage(ctx));
    // The agent box's chips name the new jobs, with their pool counts.
    const suggestionJobsP = Promise.all([poolP, newJobsP]).then(([pool, newJobs]) => pool?.newJobs ?? newJobs ?? []);

    const [
      summary,
      profile,
      funnel,
      moveData,
      followUps,
      todaysInterviews,
      screenings,
      replies,
      attentionJobs,
      resendTemplateId,
      setupFacts,
    ] = await Promise.all([
      summaryP,
      profileP,
      funnelP,
      moveP,
      followUpsP,
      profileP.then((p) =>
        section("today's interviews", () => loadTodaysInterviews(ctx, p?.timeZone ?? null)),
      ),
      section("the AI interviews to review", () => loadScreenings(ctx)),
      section("the outreach replies", () => loadOutreachReplies(ctx)),
      viewsJobs
        ? profileP.then((p) =>
            section("the jobs needing attention", () => loadAttentionJobs(ctx, p?.timeZone ?? null)),
          )
        : Promise.resolve(null),
      section("the email templates", () => loadResendTemplateId(ctx)),
      profileP.then((p) => section("the setup checklist", () => loadSetupFacts(ctx, p))),
    ]);

    const attention = companyAttentionItems({
      access: company,
      followUps: followUps ?? [],
      screenings: screenings ?? [],
      replies: replies ?? [],
      jobs: attentionJobs ?? [],
      waiting: funnel?.needsAttention ?? [],
      resendTemplateId,
      today: todayIn(profile?.timeZone, now),
      now,
    });

    const setup = setupFacts ? companySetupProgress(company, setupFacts) : null;
    const showSetup = setup !== null && setup.done < setup.total;

    // CD-REQ-039: counts only, never names, titles or ids.
    after(() =>
      eventCaptureServer({
        event: PostHogEvent.CompanyDashboardViewed,
        distinctId: user.id,
        properties: {
          attention_count: Object.fromEntries(
            ATTENTION_KINDS.map((kind) => [kind, attention.filter((item) => item.kind === kind).length]),
          ),
          has_setup_checklist: showSetup,
          setup_done: setup?.done ?? 0,
          setup_total: setup?.total ?? 0,
        },
      }),
    );

    // CD-REQ-011: the member is greeted, not the company. `displayName` is theirs.
    const memberName =
      firstName(company.displayName) ??
      firstName(user.user_metadata?.full_name as string | undefined) ??
      user.email?.split("@")[0] ??
      "there";

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <PageHeader
          eyebrow={company.name}
          title={<span className="capitalize">How are you doing today, {memberName}?</span>}
          description={companyDashboardHeadline({
            interviewsToday: todaysInterviews?.length ?? 0,
            waiting: viewsApplicants ? summary.waiting : null,
            items: attention,
          })}
          actions={<CreateJobPostButton disabled={!can(company, "jobs.create")} />}
        />

        {can(company, "agent.use") && (
          <Streamed promise={suggestionJobsP} fallback={<AskBoxSkeleton />}>
            {(newJobs) => (
              <AskRecruiterAgent
                suggestions={companyDashboardSuggestions({
                  waiting: funnel?.needsAttention ?? [],
                  newJobs,
                  pendingApproval: (attentionJobs ?? []).filter((job) => job.state === "pending_approval"),
                  starters: AGENT_ROLE_UI.company.starters,
                  allowed: (tool, jobId) =>
                    RECRUITER_TOOL_PERMISSIONS[tool].keys.some((key) => can(company, key, jobId)),
                })}
              />
            )}
          </Streamed>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
            {todaysInterviews && <TodaysInterviews interviews={todaysInterviews} now={now} />}
            {(attention.length > 0 || couldHaveAttention(company)) && (
              <CompanyNeedsAttention
                items={attention}
                stagesByJob={moveData?.stagesByJob}
                templates={moveData?.templates}
                openAiInterviews={moveData?.openAiInterviews}
              />
            )}
            {/* No skeleton: this one often has nothing to show. */}
            <Streamed promise={poolP}>{(pool) => pool?.section && <PoolMatchesCard pool={pool.section} />}</Streamed>
            <Streamed promise={newApplicationsP} fallback={viewsApplicants ? <TitledListSkeleton rows={4} /> : null}>
              {(applications) => applications && <NewApplications applications={applications} now={now} />}
            </Streamed>
            {can(company, "mcp.use") && (
              <McpConnectLink className="rounded-xl border bg-muted/30 px-4 py-3 text-sm" />
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-6" aria-label="Your hiring at a glance">
            {showSetup && <SetupChecklist companyId={company.id} progress={setup} />}
            {funnel && <CompanyPipelineCard stages={funnel.stages} newThisWeek={summary.new7d} />}
            <Streamed promise={openJobsP} fallback={viewsJobs ? <CardSkeleton lines={5} /> : null}>
              {(openJobs) => openJobs && <OpenJobsCard jobs={openJobs} canCreate={can(company, "jobs.create")} />}
            </Streamed>
            {profile?.careers && (
              <CareersCard
                slug={profile.careers.slug}
                published={profile.careers.published}
                canEdit={can(company, "careers.edit")}
              />
            )}
            <Streamed promise={usageP} fallback={canViewBilling(company) ? <CardSkeleton lines={4} /> : null}>
              {(usage) => usage && <UsageCard usage={usage} />}
            </Streamed>
          </aside>
        </div>
      </div>
    );
  } catch (error) {
    reportError("[company] dashboard failed", error);
    return <ErrorComponent />;
  }
}
