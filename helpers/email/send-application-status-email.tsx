import { render } from "react-email";
import ApplicationStatusUpdateEmail from "@/emails/ApplicationStatusUpdateEmail";
import { sendEmail } from "@/utils/email";

/**
 * Emails an applicant about a status change. A plain server module, NOT a server
 * action (RS-SEC-005): callers must have loaded the recipient from the database
 * after checking the company's relationship to the application.
 */
export async function sendApplicationStatusEmail({
  toEmail,
  jobTitle,
  companyName,
  status,
}: {
  toEmail: string;
  jobTitle: string;
  companyName: string;
  status: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const email = (
      <ApplicationStatusUpdateEmail
        jobTitle={jobTitle}
        companyName={companyName}
        newStatus={status}
      />
    );
    const [htmlContent, textContent] = await Promise.all([
      render(email),
      render(email, { plainText: true }),
    ]);

    await sendEmail({
      toEmail,
      subject: `Update: Your Application Status for ${jobTitle} at ${companyName}`,
      htmlContent,
      textContent,
    });

    return { ok: true };
  } catch (err) {
    console.error("Error sending application status email:", err);
    return { ok: false, error: "Failed to send email" };
  }
}
