"use server";

import AuthConfirmationEmail from "@/emails/AuthConfirmationEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { updateUserAppMetadata } from "./update-user-metadata";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";

const URL = deploymentUrl();

export async function sendSignupEmail(
  email: string,
  password: string,
  isCompany: boolean,
) {
  try {
    const serviceRoleSupabase = createServiceRoleClient();

    const finalRedirectUrl = isCompany ? "/get-started?company=true" : "/jobs";

    const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
      type: "signup",
      email: email,
      password: password,
    });

    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Signup link.",
      );
    } else {
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
