import { reportError } from "@/helpers/posthog/report-error";
import { BrevoClient } from "@getbrevo/brevo";
import { Resend } from "resend";
import Mailjet from "node-mailjet";

export async function sendEmail({
  toEmail,
  subject,
  htmlContent,
  textContent,
  replyTo,
  senderName,
}: {
  toEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  /** Where replies go, e.g. a company's contact email (PL-REQ-007). */
  replyTo?: string;
  /** The From name; the address is always GetHired's. */
  senderName?: string;
}) {
  const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY || "" });

  // 1. BREVO
  try {
    const accountInfo = await brevo.account.getAccount();
    const dailyPlan = accountInfo.plan?.find((p) => p.type === "free");
    const creditsRemaining = dailyPlan ? dailyPlan.credits : 0;

    console.log("daily plan: ", dailyPlan);

    if (creditsRemaining !== undefined && creditsRemaining <= 0) {
      throw new Error("Brevo daily limit reached");
    }

    const result = await brevo.transactionalEmails.sendTransacEmail({
      subject,
      htmlContent,
      sender: { name: senderName ?? "Varun from GetHired", email: "varun@devhub.co.in" },
      to: [{ email: toEmail }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    });
    console.log("Sent via Brevo:", result);
    return; // Exit on success
  } catch (brevoError) {
    reportError(
      "Brevo failed or limit reached, trying Mailjet fallback:",
      brevoError,
    );
  }

  // 2. MAILJET FALLBACK
  try {
    const mailjet = Mailjet.apiConnect(
      process.env.MJ_APIKEY_PUBLIC || "",
      process.env.MJ_APIKEY_PRIVATE || "",
    );

    const mailjetResult = await mailjet
      .post("send", { version: "v3.1" })
      .request({
        Messages: [
          {
            From: {
              Email: "varun@devhub.co.in",
              Name: senderName ?? "Varun from GetHired",
            },
            To: [{ Email: toEmail }],
            ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
            Subject: subject,
            HTMLPart: htmlContent,
            TextPart: textContent,
          },
        ],
      });

    // const messageData = mailjetResult.body?.Messages?.[0];
    const body = mailjetResult.body as { Messages?: Array<{ Status: string }> };
    const messageData = body?.Messages?.[0];

    // Check if Mailjet accepted and sent the message
    if (messageData?.Status === "success") {
      console.log("Successfully sent via Mailjet fallback");
      return; // Exit on success
    }

    throw new Error(
      `Mailjet returned non-success status: ${messageData?.Status || "Unknown"}`,
    );
  } catch (mailjetError) {
    reportError(
      "Mailjet failed or limit reached, trying Resend fallback:",
      mailjetError,
    );
  }

  // 3. RESEND FALLBACK (LAST RESORT)
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const resendResult = await resend.emails.send({
      from: `${(senderName ?? "GetHired").replace(/[<>"\r\n]/g, "")} <varun@devhub.co.in>`,
      to: [toEmail],
      ...(replyTo ? { replyTo } : {}),
      subject,
      html: htmlContent,
      text: textContent,
    });

    if (resendResult.error) {
      throw new Error(resendResult.error.message);
    }

    console.log("Successfully sent via Resend fallback");
  } catch (resendError) {
    reportError("Resend fallback also failed:", resendError);
    throw new Error(`Email delivery failed to ${toEmail}: ${resendError}`);
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
    reportError(
      "Some error occured while sending status update email to Varun Kumawat",
    );
  }
};
