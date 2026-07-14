"use server";

import { render } from "@react-email/components";
import React from "react";
import ResumeParsingStatusEmail from "@/emails/ResumeParsingStatusEmail";
import { sendEmail } from "@/utils/email";

/**
 * sendResumeParsingStatusEmail
 * Sends an automated notification when a resume finishes indexing.
 * @param email - Target user email
 * @param status - 'success' | 'failure'
 * @param resumeName - Filename of the resume
 * @param resumeId - The ID for the dashboard link
 */
export async function sendResumeParsingStatusEmail(
  email: string | null,
  status: "success" | "failure",
  resumeName: string | null,
  resumeId: string,
) {
  if (!process.env.RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY");
    return { success: false, error: "Email service not configured" };
  }

  if (!email) {
    return {
      success: false,
      error: "User email not found",
    };
  }

  const resumeLink = `https://gethired.devhub.co.in/resume/${resumeId}`;

  const emailHtml = await render(
    React.createElement(ResumeParsingStatusEmail, {
      resumeName: resumeName ?? "New Resume",
      status,
      resumeLink,
    }),
  );

  const emailText = await render(
    React.createElement(ResumeParsingStatusEmail, {
      resumeName: resumeName ?? "New Resume",
      status,
      resumeLink,
    }),
    { plainText: true },
  );

  const subject =
    status === "success"
      ? `Your Digital Twin is Ready: ${resumeName}`
      : `Action Required: Resume Parsing Issue for ${resumeName}`;

  try {
    await sendEmail({
      toEmail: email,
      subject: subject,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}
