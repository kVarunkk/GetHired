"use server";

import { render } from "@react-email/components";
import React from "react";
import ResumeReviewStatusEmail from "@/emails/ResumeReviewStatusEmail";
import { sendEmail } from "@/utils/serverUtils";

/**
 * sendResumeParsingStatusEmail
 * Sends an automated notification when a resume finishes indexing.
 * @param email - Target user email
 * @param status - 'success' | 'failure'
 * @param reviewName - Filename of the resume
 * @param reviewId - The ID for the dashboard link
 */
export async function sendResumeReviewStatusEmail(
  email: string | null,
  status: "success" | "failure",
  reviewName: string | null,
  reviewId: string,
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

  const reviewLink = `https://gethired.devhub.co.in/resume-review/${reviewId}`;

  // 1. Render the React component to HTML
  const emailHtml = await render(
    React.createElement(ResumeReviewStatusEmail, {
      reviewName: reviewName ?? "New Resume Review",
      status,
      reviewLink,
    }),
  );

  // 2. Render the plain text version
  const emailText = await render(
    React.createElement(ResumeReviewStatusEmail, {
      reviewName: reviewName ?? "New Resume Review",
      status,
      reviewLink,
    }),
    { plainText: true },
  );

  const subject =
    status === "success"
      ? `Your Resume Review is Ready: ${reviewName}`
      : `Action Required: Resume Review Issue for ${reviewName}`;

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
