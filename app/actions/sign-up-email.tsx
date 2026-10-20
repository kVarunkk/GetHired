"use server";

import AuthConfirmationEmail from "@/emails/AuthConfirmationEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "react-email";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { after } from "next/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { APPLICANT_HOME, companyOnboardingPath } from "@/helpers/user/home-path";
import { findOpenInvite, joinPath } from "@/helpers/team/invite-token";
import { INVALID_INVITE_MESSAGE } from "@/helpers/team/errors";

const URL = deploymentUrl();

type SignupOptions = {
  /**
   * Invite mode (recruiter teams, difference 5): sign up from
   * `/company/join?token=…`. The account is a company account with no company
   * of its own; accepting the invite adds the membership.
   */
  inviteToken?: string;
  /** Stored as `user_metadata.full_name`; acceptance uses it as the display name. */
  fullName?: string;
  /** Companies: where onboarding sends them once it's done, e.g. /company/agent. */
  returnTo?: string;
};

export async function sendSignupEmail(
  email: string,
  password: string,
  isCompany: boolean,
  options: SignupOptions = {},
) {
  const serviceRoleSupabase = createServiceRoleClient();
  const inviteToken = options.inviteToken;

  // Invite mode needs an open invite for this email, or it would be a way to
  // create a company account with no company.
  if (inviteToken !== undefined) {
    const invite = await findOpenInvite(serviceRoleSupabase, inviteToken);
    if (!invite || invite.email.toLowerCase() !== email.trim().toLowerCase()) {
      return { success: false, error: INVALID_INVITE_MESSAGE };
    }
  }

  const finalRedirectUrl = inviteToken
    ? joinPath(inviteToken)
    : isCompany
      ? companyOnboardingPath(options.returnTo)
      : APPLICANT_HOME;
  const fullName = options.fullName?.trim().slice(0, 80);

  const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
    type: "signup",
    email: email,
    password: password,
    ...(fullName ? { options: { data: { full_name: fullName } } } : {}),
  });

  try {
    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Signup link.",
      );
    }

    const { error: updateAppMetaError } = await setUserAppMetadata(
      data.user?.id,
      {
        type: isCompany || inviteToken ? "company" : "applicant",
        // Invitees too: acceptance sets it (TM-SEC-004), so an account that
        // never accepts can't reach /company.
        onboarding_complete: false,
      },
    );

    if (updateAppMetaError) throw new Error(updateAppMetaError);

    if (inviteToken) {
      // No company_info and no user_info: the membership comes from
      // accept_company_invite.
    } else if (isCompany) {
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
            user_type: isCompany || inviteToken ? "company" : "applicant",
            invited: !!inviteToken,
          },
        });

        const signupUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=signup&next=${encodeURIComponent(finalRedirectUrl)}`;

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
