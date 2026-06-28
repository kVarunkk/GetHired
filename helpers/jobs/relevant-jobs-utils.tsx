import { render } from "@react-email/components";
import RelevantJobsSetupUpdateEmail from "@/emails/RelevantJobsSetupUpdateEmail";
import { INTERNAL_API_SECRET, sendEmail } from "@/utils/serverUtils";
import { AllJobWithRelations } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
  userEmail: string,
  fullName: string,
) {
  const supabase = createServiceRoleClient();

  try {
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

    await supabase
      .from("user_info")
      .update({
        is_relevant_jobs_generated: true,
        is_relevant_job_update_failed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return { success: true, userEmail, fullName };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, userEmail, fullName, error: msg };
  }
}
