"use server";

import ResetPasswordEmail from "@/emails/ResetPasswordEmail";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { render } from "@react-email/components";

const URL = deploymentUrl();

export async function sendResetPasswordEmail(email: string) {
  const serviceRoleSupabase = createServiceRoleClient();

  const finalRedirectUrl = `/auth/update-password`;

  const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
    type: "recovery",
    email: email,
  });

  if (error || !data || !data.properties || !data.user) {
    return {
      success: false,
      error: error
        ? error.message
        : "Error occured while creating Password reset link.",
    };
  }

  try {
    const inviteUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=${finalRedirectUrl}`;

    const emailHtml = await render(
      <ResetPasswordEmail email={email} inviteUrl={inviteUrl} />,
    );

    const emailText = await render(
      <ResetPasswordEmail email={email} inviteUrl={inviteUrl} />,
      {
        plainText: true,
      },
    );

    await sendEmail({
      toEmail: email,
      subject: `Reset Password for ${email} on GetHired`,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    return {
      success: true,
      message: "Invitation sent successfully.",
    };
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while sending reset password email.";
    await eventCaptureServerException({
      error: err,
      distinctId: data.user.id,
      properties: { flow: "reset_password_email" },
    });

    return {
      success: false,
      error,
    };
  }
}
