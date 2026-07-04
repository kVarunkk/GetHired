import { render } from "@react-email/components";
import RelevantJobsSetupUpdateEmail from "@/emails/RelevantJobsSetupUpdateEmail";
import {
  deploymentUrl,
  INTERNAL_API_SECRET,
  sendEmail,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import { AllJobWithRelations, TAICredits } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";

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

export const singleUserTask = async (userId: string) => {
  console.log(`[RELEVANCE UPDATE] Processing single user: ${userId}`);

  const supabase = await createClient();

  try {
    const { data } = await supabase
      .from("user_info")
      .select("email, full_name, ai_credits")
      .eq("user_id", userId);

    if (data && data.length > 0) {
      const insufficientCredits =
        (data[0].ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME;

      const email = "(Onboarding)";
      const result = await processUserRelevance(
        userId,
        email,
        data[0].full_name || "",
      );

      if (!result.success) {
        await sendEmailForStatusUpdate(
          `[RELEVANCE UPDATE] Failed for ${userId}: ${result.error}. ${insufficientCredits ? "Insufficient AI credits." : ""}`,
        );
      } else {
        await sendEmailForRelevantJobsStatusUpdate(
          data[0].email!,
          data[0].full_name || "",
          URL + "/jobs?sortBy=relevance",
          insufficientCredits,
        );
      }
    } else throw new Error("user data not found");
  } catch {
    await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }
};

export async function processUserRelevance(
  userId: string,
  userEmail: string,
  fullName: string,
) {
  const supabase = createServiceRoleClient();

  try {
    // fix this route
    const response = await fetch(
      `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=30&userId=${userId}`,
      {
        headers: { "X-Internal-Secret": INTERNAL_API_SECRET || "" },
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

      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

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

    return { success: true, userEmail, fullName };
  } catch (error) {
    await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    console.log(error);
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, userEmail, fullName, error: msg };
  }
}
