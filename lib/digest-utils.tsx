import JobDigestEmail from "@/emails/JobDigestEmail";
import { createServiceRoleClient } from "./supabase/service-role";
import { IFormData, IJob } from "./types";
import { render } from "@react-email/components";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function getAllDigestUsers(): Promise<IFormData[]> {
  // Use the client with elevated privileges
  const supabase = createServiceRoleClient();

  // Select user data from the user_info table
  const { data, error } = await supabase
    .from("user_info")
    .select(
      `
            user_id, 
            email, 
            full_name, 
            is_job_digest_active
        `
    )
    .neq("email", null)
    .neq("full_name", null)
    .eq("filled", true)
    .eq("is_job_digest_active", true);

  if (error) {
    console.error("Supabase Error fetching digest users:", error);
    throw new Error("Failed to fetch eligible users for digest.");
  }

  // Map the data to your expected interface
  return data as unknown as IFormData[];
}

export async function sendJobDigestEmail(
  email: string,
  userName: string,
  jobs: IJob[],
  digestDate: string
) {
  // Check if jobs array is empty before rendering
  if (jobs.length === 0) {
    console.log(`Skipped digest for ${email}: No jobs to send.`);
    return { success: true };
  }

  // 1. Render the React Email component to HTML and Plain Text
  const emailHtml = await render(
    <JobDigestEmail userName={userName} jobs={jobs} />
  );

  const emailText = await render(
    <JobDigestEmail userName={userName} jobs={jobs} />,
    { plainText: true }
  );

  // 2. Send the email using Resend
  try {
    const { error } = await resend.emails.send({
      from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
      to: [email],
      subject: `Your Weekly Job Digest for ${digestDate}`,
      html: emailHtml,
      text: emailText,
    });

    if (error) {
      console.error(`Resend failed for ${email}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`Successfully sent ${jobs.length} jobs to ${email}.`);
    return { success: true };
  } catch (e) {
    console.error(`Error sending email to ${email}:`, e);
    return { success: false, error: (e as Error).message };
  }
}
