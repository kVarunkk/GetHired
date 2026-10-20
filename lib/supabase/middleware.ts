// import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../../utils/utils";
import { UserAppMetadata } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getUserFromRequest } from "./get-user-from-request";
import { APPLICANT_HOME, COMPANY_HOME, companyOnboardingPath } from "@/helpers/user/home-path";
import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }
  const headersList = await headers();

  const authHeader = headersList.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : null;

  if (bearerToken?.startsWith("gh_")) {
    // Only allow API routes for gh_ tokens
    // gh_ tokens are for MCP/programmatic access only
    const allowedPaths = [
      "/api/user/profile",
      "/api/jobs",
      "/api/ai-search/jobs",
      "/api/resumes",
      "/api/resume-review",
    ];

    const isAllowed = allowedPaths.some((path) =>
      request.nextUrl.pathname.startsWith(path),
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: "API tokens can only be used with API routes" },
        { status: 403 },
      );
    }
    return supabaseResponse;
  }

  const user = await getUserFromRequest();

  const deleteSearchParams = (url: URL) => {
    url.searchParams.forEach((value, key) => {
      url.searchParams.delete(key);
    });
  };

  const { pathname, searchParams } = request.nextUrl;

  const publicPaths = [
    "/",
    "/oauth/consent",
    "/jobs",
    "/hire",
    "/ai-interview",
    "/mcp-server",
    "/extension",
    "/ai-resume-checker",
    "/api/jobs",
    // Answers signed-out callers itself with a 401 JSON body. Redirecting it to
    // the login page hands SWR HTML, which fails to parse and is retried forever.
    "/api/current-user",
    "/api/profiles",
    "/api/locations",
    "/api/health",
    "/api/jobs/filters",
    "/api/companies",
    "/api/companies/filters",
    "/api/updates/applicants/digest/enqueue",
    "/api/updates/applicants/digest/worker",
    "/api/updates/applicants/applications",
    "/api/updates/applicants/favorites",
    "/api/updates/applicants/onboarding",
    "/api/updates/applicants/job-alert",
    "/api/update-embedding/gemini/job",
    "/api/updates/applicants/relevant-jobs/enqueue",
    "/api/updates/applicants/relevant-jobs/worker",
    "/api/updates/applicants/recharge/enqueue",
    "/api/updates/applicants/recharge/worker",
    "/api/updates/company/relevant-profiles/enqueue",
    "/api/updates/company/relevant-profiles/worker",
    "/api/updates/interview-analysis/worker",
    "/api/updates/company/match-explanations/worker",
    // Knockout rejection emails, 24 hours after the move (X-Internal-Secret).
    "/api/updates/knockouts/worker",
    "/api/worker/user/onboarding",
    "/api/worker/application-screening",
    // Pipeline notifications (X-Internal-Secret).
    "/api/worker/company-notifications",
    // Stage-move emails queued by the pipeline (X-Internal-Secret).
    "/api/worker/pipeline-emails",
    // Screening invite emails queued by the invite RPCs (X-Internal-Secret).
    "/api/worker/screening-invite-emails",
    "/api/updates/company/applicant-digest/enqueue",
    "/api/updates/company/applicant-digest/worker",
    "/api/updates/company/weekly-matches/enqueue",
    "/api/updates/company/weekly-matches/worker",
    // Outreach expiry (X-Internal-Secret).
    "/api/updates/outreach/expire",
    // Screening interviews: the voice server's transcript callback
    // (x-voice-callback-secret), and the expiry/reminder and retention crons
    // (X-Internal-Secret).
    "/api/internal/interview-transcript",
    "/api/updates/screening-interviews",
    "/api/updates/screening-interviews/retention",
    "/api/ai-search/jobs",
    "/api/ai-search/profiles",
    "/api/dodo/webhook",
    // Billing: the public pricing page, the daily cron (X-Internal-Secret) and
    // the admin grant route (x-api-key). Each route checks its own secret.
    "/pricing/companies",
    // Recruiter teams: the invite landing page. Signed out it offers sign-up
    // and sign-in; the page itself handles every account state.
    "/company/join",
    "/api/updates/billing",
    "/api/internal/billing/grant",
    "/privacy-policy",
    "/terms-of-service",
    "/sitemap.xml",
    "/blog",
    "/companies",
    "/about",
    "/contact",
    "/llms.txt",
    "/robots.txt",
    "/opengraph-image.jpg",
    "/twitter-image.jpg",
    "/preview/AuthConfirmationEmai",
    "/auth/update-password",
    "/api/debug/heapdump",
    "/api/extension/generate-answer",
    "/api/extension/ensure-user",
  ];

  const authPaths = [
    "/auth/login",
    "/auth/sign-up",
    "/auth/callback",
    "/auth/sign-up-success",
    "/auth/error",
    "/auth/confirm",
    "/auth/forgot-password",
  ];

  const isApplicantOnboardingPath =
    pathname === "/get-started" && !(searchParams.get("company") === "true");

  const isResumeReviewPath = pathname.startsWith("/resume-review");

  // Not /ai-interview, which is the public landing page.
  const isInterviewPath =
    pathname === "/interview" || pathname.startsWith("/interview/");

  const isAgentPath = pathname === "/agent" || pathname.startsWith("/agent/");
  const isAgentApiPath = pathname.startsWith("/api/agent/");

  const isCompanyOnboardingPath =
    pathname === "/get-started" && searchParams.get("company") === "true";

  const isJobPage =
    pathname.startsWith("/jobs/") && pathname.length > "/jobs/".length;

  const isBlogPage =
    pathname.startsWith("/blog/") && pathname.length > "/blog/".length;

  const isCompanyPage =
    pathname.startsWith("/companies/") &&
    pathname.length > "/companies/".length;

  const isRemoteJobsLocationPage =
    pathname.startsWith("/remote-jobs/") &&
    pathname.length > "/remote-jobs/".length;

  const isSitemapPage = pathname.startsWith("/sitemap/");
  // CP-SEC-001: careers pages, their job pages and their jobs API are public.
  const isCareersPath =
    (pathname.startsWith("/careers/") && pathname.length > "/careers/".length) ||
    (pathname.startsWith("/api/careers/") && pathname.length > "/api/careers/".length);
  // Exempt from the company-only and company-onboarding redirects below, so an
  // applicant sees why they can't join and an invitee who hasn't accepted yet
  // can (teams difference 4).
  const isCompanyJoinPath = pathname === "/company/join";

  const isAuthPath = authPaths.some((path) => pathname.startsWith(`${path}`));
  const isPublicPath =
    publicPaths.some((path) => pathname === path) ||
    isJobPage ||
    isBlogPage ||
    isCompanyPage ||
    isRemoteJobsLocationPage ||
    isSitemapPage ||
    isCareersPath;

  const isProtectedPath = !isAuthPath && !isPublicPath;
  const isProtectedRelevanceSearch =
    pathname === "/jobs" && searchParams.get("sortBy") === "relevance";

  // --- 1. Handle Unauthenticated Users ---
  if (!user) {
    // If an unauthenticated user tries to access a protected page, redirect them to login.

    if (isProtectedPath || isProtectedRelevanceSearch) {
      const url = request.nextUrl.clone();
      deleteSearchParams(url);

      const redirectUrl = new URL("/auth/login", url.origin);

      if (url.pathname.startsWith("/company")) {
        redirectUrl.searchParams.set("company", "true");
        // e.g. the /hire demo's links into /company/agent. The dashboard is
        // where companies land anyway.
        if (url.pathname !== COMPANY_HOME) {
          redirectUrl.searchParams.set("returnTo", url.pathname);
        }
      } else {
        redirectUrl.searchParams.set("returnTo", url.pathname + url.search);
      }
      return NextResponse.redirect(redirectUrl);
    }
    return supabaseResponse;
  }

  // --- 2. Handle Authenticated Users ---
  if (user) {
    let isApplicant = false;
    let isCompany = false;
    let isCompanyOnboarded = false;

    const appMetadata: Partial<UserAppMetadata> = user?.app_metadata || {};

    // Flags based on the new app_metadata keys
    if (appMetadata.type) {
      const userType = appMetadata.type;
      const onboardingComplete = appMetadata.onboarding_complete === true;

      isApplicant = userType === "applicant";
      isCompany = userType === "company";
      isCompanyOnboarded = isCompany && onboardingComplete;
    }

    // Redirect authenticated users away from auth pages
    if (isAuthPath) {
      const url = request.nextUrl.clone();
      let pathname;
      if (isApplicant) {
        pathname = APPLICANT_HOME;
        url.pathname = pathname;
        deleteSearchParams(url);

        return NextResponse.redirect(url);
      } else if (isCompany && isCompanyOnboarded) {
        pathname = "/company";
        url.pathname = pathname;
        deleteSearchParams(url);

        return NextResponse.redirect(url);
      } else {
        url.pathname = "/get-started";
        deleteSearchParams(url);

        if (isCompany) {
          url.searchParams.set("company", "true");
        }
        return NextResponse.redirect(url);
      }
    }

    // The landing page at / is the applicant pitch, so signed-in companies go to
    // their dashboard, or straight to onboarding if they haven't finished it.
    if (pathname === "/" && isCompany) {
      const url = request.nextUrl.clone();
      deleteSearchParams(url);
      if (isCompanyOnboarded) {
        url.pathname = COMPANY_HOME;
      } else {
        url.pathname = "/get-started";
        url.searchParams.set("company", "true");
      }
      return NextResponse.redirect(url);
    }

    // --- The agent API serves applicants and onboarded companies (RA-SEC-001) ---
    // Checked before company onboarding, so the API answers 403 rather than
    // redirecting a company that hasn't onboarded yet. The page itself goes
    // through the onboarding redirect below.
    if (isCompany && !isCompanyOnboarded && isAgentApiPath) {
      return NextResponse.json(
        { error: "Finish setting up your company first." },
        { status: 403 },
      );
    }
    // Companies use the agent at /company/agent; /agent is the applicants'.
    // The query (?prompt=, ?session=) carries over. A company that hasn't
    // onboarded goes straight to onboarding (below) instead.
    if (isCompanyOnboarded && isAgentPath) {
      const url = request.nextUrl.clone();
      url.pathname = COMPANY_AGENT_PATH;
      return NextResponse.redirect(url);
    }

    // --- Enforce Company Onboarding ---
    // If the user has no profile and is not on an onboarding page, redirect them.
    if (
      isCompany &&
      !isCompanyOnboarded &&
      !isCompanyOnboardingPath &&
      !isPublicPath
    ) {
      // A company page they were heading for (e.g. /company/agent) is where
      // onboarding sends them when it's done.
      return NextResponse.redirect(
        new URL(
          companyOnboardingPath(pathname.startsWith("/company/") ? pathname : null),
          request.nextUrl.origin,
        ),
      );
    }

    // --- Restrict Access to Company Routes ---
    if (
      (pathname.startsWith("/company") || isCompanyOnboardingPath) &&
      !isCompany &&
      !isCompanyJoinPath
    ) {
      const url = request.nextUrl.clone();
      // Users without a role yet can't open the agent, so they get the job board.
      url.pathname = isApplicant ? APPLICANT_HOME : "/jobs";
      deleteSearchParams(url);

      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/company") && !isCompanyOnboarded && isCompany && !isCompanyJoinPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/get-started";
      deleteSearchParams(url);

      url.searchParams.set("company", "true");
      return NextResponse.redirect(url);
    }

    // --- Restrict Access to Applicant only routes(dashboard, settings, opportunities, get-started, agent, interview) ---
    if (
      (pathname.startsWith("/dashboard") ||
        pathname === "/settings" ||
        pathname.startsWith("/settings/") ||
        pathname.startsWith("/opportunities") ||
        isApplicantOnboardingPath ||
        isResumeReviewPath ||
        isInterviewPath ||
        isAgentPath) &&
      !isApplicant
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      deleteSearchParams(url);

      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
