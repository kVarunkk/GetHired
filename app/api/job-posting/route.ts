import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId parameter." },
      { status: 400 },
    );
  }

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

  const { data, error } = await supabase
    .from("job_postings")
    .select("*")
    .eq("id", jobId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch job posting." },
      { status: 500 },
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Job posting not found." },
      { status: 404 },
    );
  }

  // JP-SEC-003: any signed-in user can call this, so the job's pipeline (an
  // internal company setting) stays out of the response.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pipeline_id, ...job } = data[0];
  return NextResponse.json({ data: job });
}
