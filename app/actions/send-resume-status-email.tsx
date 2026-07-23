"use server";

import { render } from "@react-email/components";
import React from "react";
import ResumeParsingStatusEmail from "@/emails/ResumeParsingStatusEmail";
import { sendEmail } from "@/utils/email";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

/**
 * sendResumeParsingStatusEmail
 * Sends an automated notification when a resume finishes indexing.
 * @param email - Target user email
 * @param status - 'success' | 'failure'
 * @param resumeName - Filename of the resume
 * @param resumeId - The ID for the dashboard link
 * @param userId - The ID for the user
 */
export async function sendResumeParsingStatusEmail(
  email: string | null,
  status: "success" | "failure",
  resumeName: string | null,
  resumeId: string,
  userId: string,
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
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while sending resume status update email.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "send_resume_status_email" },
    });

    return {
      success: false,
      error,
    };
  }
}
