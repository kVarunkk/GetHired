import { render } from "@react-email/components";
import RelevantJobsSetupUpdateEmail from "@/emails/RelevantJobsSetupUpdateEmail";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { AllJobWithRelations, TAICredits } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

const URL = deploymentUrl();

export const sendEmailForRelevantJobsStatusUpdate = async (
  email: string,
  name: string,
  url: string,
  insufficientCredits = false,
) => {
  try {
    const emailHtml = await render(
      <RelevantJobsSetupUpdateEmail
        userName={name}
        inviteUrl={url}
        insufficientCredits={insufficientCredits}
      />,
    );

    const emailText = await render(
      <RelevantJobsSetupUpdateEmail
        userName={name}
        inviteUrl={url}
        insufficientCredits={insufficientCredits}
      />,
      {
        plainText: true,
      },
    );

    sendEmail({
      toEmail: email,
      subject: `Important: Your AI Smart Search Job Feed is ready!`,
      htmlContent: emailHtml,
      textContent: emailText,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat",
    );
  }
};

export async function processUserRelevance(
  userId: string,
  isInternalCall: boolean = false,
) {
  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  try {
    const { data, error } = await supabase
      .from("user_info")
      .select("email, full_name, ai_credits")
      .eq("user_id", userId)
      .single();

    if (!data || error) {
      throw new Error(error.message || "User not found.");
    }

    const insufficientCredits =
      (data.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME;

    if (!insufficientCredits) {
      const headersList = await headers();
      const cookie = headersList.get("Cookie");

      const requestHeaders: Record<string, string> = {};
      if (isInternalCall) {
        requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
      } else if (cookie) {
        requestHeaders["Cookie"] = cookie;
      }

      const response = await fetch(
        `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=30&userId=${userId}`,
        {
          cache: "no-cache",
          headers: requestHeaders,
        },
      );

      if (!response.ok) throw new Error(`Jobs API returned ${response.status}`);

      const json = await response.json();
      const jobs: AllJobWithRelations[] = json.data || [];

      const rowsToInsert = jobs.map((job, index) => ({
        user_id: userId,
        jobs_id: job.id,
        relevance_rank: index + 1,
        updated_at: new Date().toISOString(),
      }));

      const { error: deleteError } = await supabase
        .from("user_relevant_jobs")
        .delete()
        .eq("user_id", userId);

      if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("user_relevant_jobs")
          .insert(rowsToInsert);

        if (insertError)
          throw new Error(`Insert failed: ${insertError.message}`);
      }
    }

    // this will run even if the user has Insufficient AI Credits
    const { error: updateError } = await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError)
      throw new Error(
        "Some error occured while updating relevant jobs generation info",
      );

    // email to user in case of success

    await sendEmailForRelevantJobsStatusUpdate(
      data.email!,
      data.full_name || "",
      URL + "/jobs?sortBy=relevance",
      insufficientCredits,
    );

    return { success: true };
  } catch (error) {
    await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    const msg =
      error instanceof Error ? error.message : "unknown error occured.";

    // emmail to admin in case of error
    await sendEmailForStatusUpdate(
      `[RELEVANCE UPDATE] Failed for ${userId}: ${msg}.`,
    );
    return { success: false, error: msg };
  }
}
