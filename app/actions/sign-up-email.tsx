"use server";

import AuthConfirmationEmail from "@/emails/AuthConfirmationEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { updateUserAppMetadata } from "./update-user-metadata";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { after } from "next/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

const URL = deploymentUrl();

export async function sendSignupEmail(
  email: string,
  password: string,
  isCompany: boolean,
) {
  const serviceRoleSupabase = createServiceRoleClient();

  const finalRedirectUrl = isCompany ? "/get-started?company=true" : "/jobs";

  const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
    type: "signup",
    email: email,
    password: password,
  });

  try {
    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Signup link.",
      );
    }

    const { error: updateAppMetaError } = await updateUserAppMetadata(
      data.user?.id,
      {
        type: isCompany ? "company" : "applicant",
        onboarding_complete: false,
      },
    );

    if (updateAppMetaError) throw new Error(updateAppMetaError);

    if (isCompany) {
      const { error: signupUserError } = await serviceRoleSupabase
        .from("company_info")
        .insert({ user_id: data.user.id, email });

      if (signupUserError)
        throw new Error("Error creating record for new user.");
    } else {
      const { error: signupUserError } = await serviceRoleSupabase
        .from("user_info")
        .insert({
          user_id: data.user?.id,
          email,
          is_job_digest_active: true,
          is_promotion_active: true,
        });

      if (signupUserError)
        throw new Error("Error creating record for new user.");
    }

    after(async () => {
      try {
        await eventCaptureServer({
          event: PostHogEvent.SignupRequested,
          distinctId: data.user?.id,
          properties: {
            user_type: isCompany ? "company" : "applicant",
          },
        });

        const signupUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=signup&next=${finalRedirectUrl}`;

        const emailHtml = await render(
          <AuthConfirmationEmail signupUrl={signupUrl} />,
        );

        const emailText = await render(
          <AuthConfirmationEmail signupUrl={signupUrl} />,
          {
            plainText: true,
          },
        );

        await sendEmail({
          toEmail: email,
          subject: "Confirm your Signup to GetHired",
          htmlContent: emailHtml,
          textContent: emailText,
        });
      } catch (err) {
        const error =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred in the send signup email after block.";
        await eventCaptureServerException({
          error: error,
          distinctId: data.user?.id,
          properties: { flow: "sign_up_email_after_block" },
        });
      }
    });

    return {
      success: true,
      message: "Invitation sent successfully.",
    };
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while sending user sign up email.";
    await eventCaptureServerException({
      error: err,
      distinctId: data.user?.id,
      properties: { flow: "sign_up_email" },
    });

    return {
      success: false,
      error,
    };
  }
}
