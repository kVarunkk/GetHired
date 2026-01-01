"use server";

import ResetPasswordEmail from "@/emails/ResetPasswordEmail";
import { deploymentUrl } from "@/lib/serverUtils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { Resend } from "resend";

const URL = deploymentUrl();

const resend = new Resend(process.env.RESEND_API_KEY);

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
          : "Error occured while creating Password reset link."
      );
    } else {
      const inviteUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=${finalRedirectUrl}`;

      const emailHtml = await render(
        <ResetPasswordEmail email={email} inviteUrl={inviteUrl} />
      );

      const emailText = await render(
        <ResetPasswordEmail email={email} inviteUrl={inviteUrl} />,
        {
          plainText: true,
        }
      );

      const { error } = await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
        to: [email],
        subject: `Reset Password for ${email} on GetHired`,
        html: emailHtml,
        text: emailText,
      });

      if (error) throw new Error("Error sending password reset email.");

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
