import JobDigestEmail from "@/emails/JobDigestEmail";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { render } from "@react-email/components";
import { AllJobWithRelations } from "@/utils/types";
import { sendEmail } from "@/utils/serverUtils";

export async function getAllDigestUsers() {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("user_info")
    .select(
      `
            user_id, 
            email, 
            full_name, 
            is_job_digest_active,
            ai_credits
        `,
    )
    .neq("email", null)
    .neq("full_name", null)
    .eq("filled", true)
    .eq("is_job_digest_active", true);

  if (error) {
    console.error("Supabase Error fetching digest users:", error);
    throw new Error("Failed to fetch eligible users for digest.");
  }

  return data;
}

export async function sendJobDigestEmail(
  email: string,
  userName: string,
  jobs: AllJobWithRelations[],
  digestDate: string,
  insufficientCredits: boolean = false,
) {
  const emailHtml = await render(
    <JobDigestEmail
      userName={userName}
      jobs={jobs}
      insufficientCredits={insufficientCredits}
    />,
  );

  const emailText = await render(
    <JobDigestEmail
      userName={userName}
      jobs={jobs}
      insufficientCredits={insufficientCredits}
    />,
    { plainText: true },
  );

  try {
    await sendEmail({
      toEmail: email,
      subject: `Your Daily Job Digest for ${digestDate}`,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    console.log(`Successfully sent ${jobs.length} jobs to ${email}.`);
    return { success: true };
  } catch (e) {
    console.error(`Error sending email to ${email}:`, e);
    return { success: false, error: (e as Error).message };
  }
}
