import * as React from "react";
import { render } from "react-email";
import ResumeReuploadEmail from "@/emails/ResumeReuploadEmail";
import { reportError } from "@/helpers/posthog/report-error";
import { sendEmail } from "@/utils/email";

/**
 * RE-REQ-098: tells a user their resume file couldn't be re-parsed and asks for
 * it again. Returns false when it couldn't send, so the caller can try next run
 * rather than marking the file as notified.
 */
export async function sendResumeReuploadEmail(toEmail: string | null, resumeName: string) {
  if (!toEmail) return false;

  const props = { resumeName };
  const [htmlContent, textContent] = await Promise.all([
    render(React.createElement(ResumeReuploadEmail, props)),
    render(React.createElement(ResumeReuploadEmail, props), { plainText: true }),
  ]);

  try {
    await sendEmail({
      toEmail,
      subject: `Please upload ${resumeName} again`,
      htmlContent,
      textContent,
    });
    return true;
  } catch (error) {
    reportError("[RESUME_REUPLOAD_EMAIL_FAILED]:", error);
    return false;
  }
}
