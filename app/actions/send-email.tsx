"use server";

import { render } from "@react-email/components";
import ApplicationStatusUpdateEmail from "@/emails/ApplicationStatusUpdateEmail";
import { sendEmail } from "@/utils/serverUtils";

export async function sendStatusUpdateEmail(
  email: string,
  newStatus: string,
  jobTitle: string,
  companyName: string,
) {
  const emailHtml = await render(
    (
      <ApplicationStatusUpdateEmail
        jobTitle={jobTitle}
        companyName={companyName}
        newStatus={newStatus}
      />
    ) as React.ReactElement,
  );

  const emailText = await render(
    <ApplicationStatusUpdateEmail
      jobTitle={jobTitle}
      companyName={companyName}
      newStatus={newStatus}
    />,
    { plainText: true },
  );

  try {
    await sendEmail({
      toEmail: email,
      subject: `Update: Your Application Status for ${jobTitle} at ${companyName}`,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    return { success: true };
  } catch (err) {
    console.error("Error sending email:", err);
    return { success: false, error: "Failed to send email" };
  }
}
