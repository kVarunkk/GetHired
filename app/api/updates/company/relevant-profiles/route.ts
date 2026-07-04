import {
  processJobPostingRelevance,
  sendEmailForRelevantProfilesStatusUpdate,
} from "@/helpers/profiles/relevant-profiles-utils";
import { createClient } from "@/lib/supabase/server";
import { deploymentUrl, sendEmailForStatusUpdate } from "@/utils/serverUtils";
import { after, NextRequest, NextResponse } from "next/server";

const URL = deploymentUrl();

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized access or user mismatch." },
      { status: 401 },
    );
  }
  const userId = user.id;
  const searchParams = request.nextUrl.searchParams;
  const jobPostingId = searchParams.get("jobPostingId");

  if (!jobPostingId) {
    return NextResponse.json(
      {
        error: "Job posting id not found",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const singleUserTask = async () => {
      try {
        console.log(
          `[JOB POSTING RELEVANCE UPDATE] Processing single job posting: ${jobPostingId}`,
        );
        const { data } = await supabase
          .from("company_info")
          .select("id, name, email")
          .eq("user_id", userId);

        if (data && data.length > 0) {
          const { data: jobPostingsData } = await supabase
            .from("job_postings")
            .update({ matching_status: "progress", matching_error: null })
            .eq("id", jobPostingId)
            .select("title")
            .single();
          const result = await processJobPostingRelevance(
            jobPostingId,
            "(Onboarding)",
            data[0].name || "Recruiter",
          );

          if (!result.success) {
            await supabase
              .from("job_postings")
              .update({
                matching_status: "failed",
                matching_error: result.error,
                matched_at: new Date().toISOString(),
              })
              .eq("id", jobPostingId);
            // to user
            await sendEmailForRelevantProfilesStatusUpdate(
              data[0].email!,
              data[0].name || "",
              jobPostingsData?.title || "",
              URL +
                "/company/profiles?sortBy=relevance&job_post=" +
                jobPostingId,
              "failure",
              result.error,
            );
            // to admin
            await sendEmailForStatusUpdate(
              `[JOB POSTING RELEVANCE UPDATE] Failed for job posting id ${jobPostingId}: ${result.error}.`,
            );
          } else {
            await supabase
              .from("job_postings")
              .update({
                matching_status: "completed",
                matched_at: new Date().toISOString(),
              })
              .eq("id", jobPostingId);

            await sendEmailForRelevantProfilesStatusUpdate(
              data[0].email!,
              data[0].name || "",
              jobPostingsData?.title || "",
              URL +
                "/company/profiles?sortBy=relevance&job_post=" +
                jobPostingId,
              "success",
            );
          }
        }
      } catch (error) {
        // This is the ONLY place that will actually catch errors from this background task
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[JOB POSTING RELEVANCE UPDATE] Critical failure for ${jobPostingId}:`,
          errorMsg,
        );

        await supabase
          .from("job_postings")
          .update({
            matching_status: "failed",
            matching_error: errorMsg,
            matched_at: new Date().toISOString(),
          })
          .eq("id", jobPostingId);

        await sendEmailForStatusUpdate(
          `JOB POSTING RELEVANT PROFILES CRITICAL FAILURE for ${jobPostingId}:\n${errorMsg}`,
        );
      }
    };

    after(singleUserTask);
    return NextResponse.json({
      success: true,
      message: `Triggered background relevance update for job posting ${jobPostingId}`,
    });
  } catch (error) {
    console.error("Critical Failure in Relevant Jobs Cron:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `JOB POSTINGS RELEVANT PROFILES CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { error: "Internal Server Error. " + errorMsg },
      { status: 500 },
    );
  }
}
