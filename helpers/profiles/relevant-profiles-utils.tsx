import { RelevantProfilesUpdateEmail } from "@/emails/RelevantProfilesUpdateEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deploymentUrl, sendEmail } from "@/utils/serverUtils";
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
  jobPostingId: string,
  userEmail: string,
  fullName: string,
) {
  const supabase = createServiceRoleClient();
  const headersList = await headers();

  try {
    const response = await fetch(
      `${URL}/api/profiles?sortBy=relevance&job_post=${jobPostingId}&type=digest`,
      {
        headers: {
          Cookie: headersList.get("Cookie") || "",
        },
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

    return { success: true, userEmail, fullName };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(msg);
    return {
      success: false,
      userEmail,
      fullName,
      error: error instanceof Error ? error.message : "Unknown error occured.",
    };
  }
}
