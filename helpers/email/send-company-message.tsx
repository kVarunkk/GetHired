import { reportError } from "@/helpers/posthog/report-error";
import { render } from "react-email";
import CompanyMessageEmail from "@/emails/CompanyMessageEmail";
import { sendEmail } from "@/utils/email";

/**
 * Sends a company's templated message to a candidate (PL-TASK-031), from
 * GetHired's address with `reply-to` set to the company's contact email. A
 * plain server module, NOT a server action: callers load the recipient from
 * the database after checking the company owns the application.
 */
export async function sendCompanyMessage({
  toEmail,
  subject,
  bodyMd,
  companyName,
  companyEmail,
  logoUrl,
}: {
  toEmail: string;
  subject: string;
  bodyMd: string;
  companyName: string;
  companyEmail: string | null;
  logoUrl: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const email = (
      <CompanyMessageEmail
        companyName={companyName}
        companyEmail={companyEmail}
        logoUrl={logoUrl}
        subject={subject}
        bodyMd={bodyMd}
      />
    );
    const [htmlContent, textContent] = await Promise.all([
      render(email),
      render(email, { plainText: true }),
    ]);

    await sendEmail({
      toEmail,
      subject,
      htmlContent,
      textContent,
      senderName: `${companyName} via GetHired`,
      ...(companyEmail ? { replyTo: companyEmail } : {}),
    });

    return { ok: true };
  } catch (err) {
    reportError("Error sending a company message:", err);
    return { ok: false, error: "Failed to send email" };
  }
}
