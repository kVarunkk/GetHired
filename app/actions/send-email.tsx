"use server";

// import { Resend } from "resend";
import { render } from "@react-email/components";
import ApplicationStatusUpdateEmail from "@/emails/ApplicationStatusUpdateEmail";
import { sendEmail } from "@/utils/serverUtils";

// const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendStatusUpdateEmail(
  email: string,
  newStatus: string,
  jobTitle: string,
  companyName: string,
) {
  // 1. Render the React component to HTML
  const emailHtml = await render(
    (
      <ApplicationStatusUpdateEmail
        jobTitle={jobTitle}
        companyName={companyName}
        newStatus={newStatus}
      />
    ) as React.ReactElement,
  );

  // 2. Render the plain text version (for email clients that need it)
  const emailText = await render(
    <ApplicationStatusUpdateEmail
      jobTitle={jobTitle}
      companyName={companyName}
      newStatus={newStatus}
    />,
    { plainText: true },
  );

  try {
    // const { error } = await resend.emails.send({
    //   from: "GetHired <varun@devhub.co.in>",
    //   to: [email],
    //   subject: `Update: Your Application Status for ${jobTitle} at ${companyName}`,
    //   html: emailHtml, // Use the rendered component HTML
    //   text: emailText, // Use the rendered plain text
    // });

    // if (error) {
    //   console.error("Resend email error:", error);
    //   throw new Error("Failed to send email");
    // }

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
