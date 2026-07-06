import { RelevantProfilesUpdateEmail } from "@/emails/RelevantProfilesUpdateEmail";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deploymentUrl,
  INTERNAL_API_SECRET,
  sendEmail,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import { AllProfileWithRelations } from "@/utils/types";
import { render } from "@react-email/components";
import { headers } from "next/headers";

const URL = deploymentUrl();

export const sendEmailForRelevantProfilesStatusUpdate = async (
  email: string,
  name: string,
  jobName: string,
  url: string,
  status: "success" | "failure",
  error?: string,
) => {
  try {
    const emailHtml = await render(
      <RelevantProfilesUpdateEmail
        userName={name}
        jobName={jobName}
        inviteUrl={url}
        status={status}
        error={error}
      />,
    );

    const emailText = await render(
      <RelevantProfilesUpdateEmail
        userName={name}
        jobName={jobName}
        inviteUrl={url}
        status={status}
        error={error}
      />,
      {
        plainText: true,
      },
    );

    sendEmail({
      toEmail: email,
      subject: `Important: Your AI Smart Search Profile Feed for ${jobName} is ready!`,
      htmlContent: emailHtml,
      textContent: emailText,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to " +
        email +
        "for relevant profile update.",
    );
  }
};

export async function processJobPostingRelevance(
  userId: string,
  jobPostingId: string,
  isInternalCall: boolean = false,
) {
  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  try {
    const { data: companyData, error: companyError } = await supabase
      .from("company_info")
      .select("id, name, email")
      .eq("user_id", userId)
      .single();

    if (!companyData || companyError)
      throw new Error(companyError.message || "Company user not found.");

    const { data: jobPostingsData, error: jobPostingsError } = await supabase
      .from("job_postings")
      .select("title")
      .eq("id", jobPostingId)
      .single();

    if (!jobPostingsData || jobPostingsError)
      throw new Error(
        jobPostingsError.message || "Job posting data not found.",
      );

    const headersList = await headers();
    const cookie = headersList.get("Cookie");
    const requestHeaders: Record<string, string> = {};
    if (isInternalCall) {
      requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
    } else if (cookie) {
      requestHeaders["Cookie"] = cookie;
    }
    const response = await fetch(
      `${URL}/api/profiles?sortBy=relevance&job_post=${jobPostingId}&userId=${userId}&type=digest`,
      {
        headers: requestHeaders,
      },
    );

    if (!response.ok) throw new Error(`Failed to fetch relevant profiles.`);

    const json = await response.json();
    const profiles: AllProfileWithRelations[] = json.data || [];

    const rowsToInsert = profiles.map((profile, index) => ({
      job_posting_id: jobPostingId,
      user_id: profile.user_id,
      relevance_rank: index + 1,
      updated_at: new Date().toISOString(),
    }));

    const { error: deleteError } = await supabase
      .from("job_relevant_profiles")
      .delete()
      .eq("job_posting_id", jobPostingId);

    if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("job_relevant_profiles")
        .insert(rowsToInsert);

      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

    const { error: updateError } = await supabase
      .from("job_postings")
      .update({
        matching_status: "completed",
        matching_error: null,
        matched_at: new Date().toISOString(),
      })
      .eq("id", jobPostingId);

    if (updateError)
      throw new Error(
        "Some error occured while updating relevant profiles generation info",
      );

    await sendEmailForRelevantProfilesStatusUpdate(
      companyData.email!,
      companyData?.name || "",
      jobPostingsData?.title || "",
      URL + "/company/profiles?sortBy=relevance&job_post=" + jobPostingId,
      "success",
    );

    return { success: true };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown error occured.";

    await supabase
      .from("job_postings")
      .update({
        matching_status: "failed",
        matching_error: msg,
        matched_at: new Date().toISOString(),
      })
      .eq("id", jobPostingId);

    // to admin
    await sendEmailForStatusUpdate(
      `[JOB POSTING RELEVANCE UPDATE] Failed for job posting id ${jobPostingId}: ${msg}.`,
    );
    return {
      success: false,
      error: msg,
    };
  }
}
