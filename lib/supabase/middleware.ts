import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { UserAppMetadata } from "@supabase/supabase-js";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const deleteSearchParams = (url: URL) => {
    url.searchParams.forEach((value, key) => {
      url.searchParams.delete(key);
    });
  };

  const { pathname, searchParams } = request.nextUrl;

  const publicPaths = [
    "/",
    "/jobs",
    "/hire",
    "/ai-resume-checker",
    "/api/jobs",
    "/api/locations",
    "/api/jobs/filters",
    "/api/companies",
    "/api/companies/filters",
    "/api/updates/applicants/digest",
    "/api/updates/applicants/applications",
    "/api/updates/applicants/favorites",
    "/api/updates/applicants/onboarding",
    "/api/updates/applicants/job-alert",
    "/api/update-embedding/gemini/job",
    "/api/updates/applicants/relevant-jobs",
    "/api/ai-search/jobs",
    "/api/dodo/webhook",
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

      if (url.pathname.startsWith("/company")) {
        url.pathname = "/auth/login";
        url.searchParams.set("company", "true");
      } else url.pathname = "/auth/login";
      return NextResponse.redirect(url);
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
    } else {
      // Fallback to old method if app_metadata.type is missing
      const { data: userInfoData } = await supabase
        .from("user_info")
        .select("user_id")
        .eq("user_id", user.id)
        .single();

      if (!userInfoData?.user_id) {
        const { data: companyInfoData } = await supabase
          .from("company_info")
          .select("user_id, filled")
          .eq("user_id", user.id)
          .single();

        if (companyInfoData?.user_id) {
          isCompany = true;
          isCompanyOnboarded = companyInfoData.filled;
        }
      } else {
        isApplicant = true;
      }
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
      !publicPaths
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
