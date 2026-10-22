import { reportError } from "@/helpers/posthog/report-error";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlanSummary } from "@/helpers/billing/entitlements";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { roleLabel } from "@/helpers/companies/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const userRole = user.app_metadata?.type as
    "applicant" | "company" | undefined;
  const userId = user.id;

  let profileData = null;
  let tableName: "user_info" | "company_info" | null = null;
  let selectString;

  if (userRole === "applicant") {
    tableName = "user_info";
    selectString =
      "user_id, ai_credits, relevant_jobs_update_status, linkedin_url, github_url, preferred_locations, min_salary, salary_currency, user_favorites(job_id), user_favorites_companies(company_id), applications(all_jobs_id, status), filled, resumes(id, name, created_at, is_primary, resume_path, parsing_failed), job_feedback(job_id, vote_type)";
  } else if (userRole === "company") {
    tableName = "company_info";
    selectString =
      "id, user_id, company_favorites(user_id)";
  } else {
    return NextResponse.json(
      { profile: null, role: null, message: "Profile role not set." },
      { status: 200 },
    );
  }

  try {
    // A company user's company comes from their membership (recruiter teams),
    // so every member gets the company's favorites and job posts.
    const company = userRole === "company" ? await getMyCompany(supabase, user) : null;
    const { data, error } =
      userRole === "company"
        ? company
          ? await supabase.from("company_info").select(selectString).eq("id", company.id).single()
          : { data: null, error: null }
        : await supabase.from(tableName).select(selectString).eq("user_id", userId).single();

    if (error || !data) {
      return NextResponse.json(
        {
          profile: null,
          role: userRole,
          message: "Profile data missing in DB.",
        },
        { status: 200 },
      );
    }

    profileData = data;

    if (userRole === "company") {
      // "Plan: Startup · 1,240 credits" in the profile menu.
      const companyId = (data as unknown as { id: string }).id;
      const plan = await getPlanSummary(companyId).catch((err) => {
        reportError("[current-user] couldn't load the plan", err);
        return null;
      });
      // The role's name and what the menus may show (RP-REQ-016); the server
      // checks every permission again on each request.
      profileData = {
        ...(data as object),
        plan: company && can(company, "billing.view") ? plan : null,
        roleLabel: roleLabel(company),
        access: { billingView: can(company, "billing.view"), isOwner: Boolean(company?.isOwner) },
      };
    }
  } catch (error) {
    reportError("[current-user] failed", error);
    return NextResponse.json(
      { error: "Server error fetching profile data." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    profile: profileData,
    role: userRole,
    message: "Success.",
  });
}
