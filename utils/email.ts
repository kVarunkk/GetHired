import { BrevoClient } from "@getbrevo/brevo";
import { Resend } from "resend";

export async function sendEmail({
  toEmail,
  subject,
  htmlContent,
  textContent,
}: {
  toEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}) {
  try {
    const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY || "" });
    await brevo.transactionalEmails.sendTransacEmail({
      subject,
      htmlContent,
      sender: { name: "Varun from GetHired", email: "varun@devhub.co.in" },
      to: [{ email: toEmail }],
    });
  } catch (brevoError) {
    console.error("Brevo failed, trying Resend fallback:", brevoError);
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>",
        to: [toEmail],
        subject,
        html: htmlContent,
        text: textContent,
      });
    } catch (resendError) {
      console.error("Resend fallback also failed:", resendError);
      throw new Error(`Email delivery failed to ${toEmail}: ${resendError}`);
    }
  }
}

export const sendEmailForStatusUpdate = async (emailText: string) => {
  try {
    await sendEmail({
      toEmail: "varunkumawatleap2@gmail.com",
      subject: `Important: Status Update`,
      htmlContent: `<p>${emailText}</p>`,
      textContent: emailText,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat",
    );
  }
};
