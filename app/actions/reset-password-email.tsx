"use server";

import ResetPasswordEmail from "@/emails/ResetPasswordEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { render } from "@react-email/components";

const URL = deploymentUrl();

export async function sendResetPasswordEmail(email: string) {
  try {
    const serviceRoleSupabase = createServiceRoleClient();

    const finalRedirectUrl = `/auth/update-password`;

    const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
      type: "recovery",
      email: email,
    });

    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error
          ? error.message
          : "Error occured while creating Password reset link.",
      );
    } else {
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
    }
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
