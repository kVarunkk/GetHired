import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("all_jobs")
    .select(
      `
    ${allJobsSelectString},
    description,
    job_postings(
      id, title, job_type, salary_range, status, location,
      min_salary, max_salary, min_experience, max_experience,
      visa_sponsorship, experience, equity_range, salary_currency, questions,
      company_info(id, name, website, logo_url, description, industry, company_size, headquarters)
    )
  `,
    )
    .eq("id", job_id)
    .single();

  if (error) {
    console.log(error);
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json(data);
}
