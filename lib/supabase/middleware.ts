// import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../../utils/utils";
import { UserAppMetadata } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getUserFromRequest } from "./get-user-from-request";

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
    "/mcp-server",
    "/ai-resume-checker",
    "/api/jobs",
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
    "/api/worker/user/onboarding",
    "/api/ai-search/jobs",
    "/api/ai-search/profiles",
    "/api/dodo/webhook",
    "/api/internal/jobs/bulk-upsert",
    "/api/internal/scraper-state",
    "/privacy-policy",
    "/terms-of-service",
    "/sitemap.xml",
    "/blog",
    "/companies",
    "/robots.txt",
    "/opengraph-image.jpg",
    "/twitter-image.jpg",
    "/preview/AuthConfirmationEmai",
    "/auth/update-password",
    // "/api/debug/memory",
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

  const isAuthPath = authPaths.some((path) => pathname.startsWith(`${path}`));
  const isPublicPath =
    publicPaths.some((path) => pathname === path) ||
    isJobPage ||
    isBlogPage ||
    isCompanyPage ||
    isRemoteJobsLocationPage ||
    isSitemapPage;

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
        pathname = "/jobs";
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

    // --- Enforce Company Onboarding ---
    // If the user has no profile and is not on an onboarding page, redirect them.
    if (
      isCompany &&
      !isCompanyOnboarded &&
      !isCompanyOnboardingPath &&
      !isPublicPath
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/get-started";
      deleteSearchParams(url);

      url.searchParams.set("company", "true");
      return NextResponse.redirect(url);
    }

    // --- Restrict Access to Company Routes ---
    if (
      (pathname.startsWith("/company") || isCompanyOnboardingPath) &&
      !isCompany
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/jobs";
      deleteSearchParams(url);

      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/company") && !isCompanyOnboarded && isCompany) {
      const url = request.nextUrl.clone();
      url.pathname = "/get-started";
      deleteSearchParams(url);

      url.searchParams.set("company", "true");
      return NextResponse.redirect(url);
    }

    // --- Restrict Access to Applicant only routes(dashboard and get-started) ---
    if (
      (pathname.startsWith("/dashboard") ||
        isApplicantOnboardingPath ||
        isResumeReviewPath) &&
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
