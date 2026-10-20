"use server";

import InviteUserEmail from "@/emails/InviteUserEmail";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "react-email";
import { v4 as uuidv4 } from "uuid";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { deploymentUrl } from "@/utils/formatters";
import { sendEmail } from "@/utils/email";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { APPLICANT_HOME } from "@/helpers/user/home-path";

const URL = deploymentUrl();

/**
 * SERVER ACTION: invites `invitedEmail` on behalf of the session user. The
 * referrer always comes from the session, and the invitation and counter are
 * written with the service role (the user can't write either: BW-F01, BW-F04).
 */
export async function sendInviteEmail(invitedEmail: string) {
  let referrerUserId = "anonymous";
  try {
    const user = await getUserFromRequest();
    if (!user) throw new Error("Sign in first.");
    referrerUserId = user.id;

    const parsedEmail = z.string().trim().toLowerCase().email().safeParse(invitedEmail);
    if (!parsedEmail.success) throw new Error("Enter a valid email address.");
    invitedEmail = parsedEmail.data;

    const serviceRoleSupabase = createServiceRoleClient();

    const { data: existingUsers } = await serviceRoleSupabase
      .from("user_info")
      .select("user_id")
      .eq("email", invitedEmail);
    if (existingUsers && existingUsers.length > 0) {
      throw new Error("This user is already registered on GetHired.");
    }

    const { data: referrerData, error: refError } = await serviceRoleSupabase
      .from("user_info")
      .select("referral_code, full_name, email, invitations_count")
      .eq("user_id", referrerUserId)
      .single();

    if (refError || !referrerData) {
      throw new Error("Failed to retrieve inviter's code.");
    }
    if (referrerData.invitations_count >= 5) {
      throw new Error(
        "No more invitations available. Please purchase credits to continue using the AI features.",
      );
    }
    const referralCode = referrerData.referral_code;

    const finalRedirectUrl = `${APPLICANT_HOME}?ref=${referralCode}`;

    const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
      type: "signup",
      email: invitedEmail,
      password: uuidv4(),
    });

    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Invite link.",
      );
    } else {
      const { error: updateAppMetaError } = await setUserAppMetadata(
        data.user?.id,
        {
          type: "applicant",
          onboarding_complete: false,
        },
      );

      if (updateAppMetaError) throw new Error(updateAppMetaError);

      if (data.user.email) {
        const { error: invitedUserError } = await serviceRoleSupabase
          .from("user_info")
          .insert({
            user_id: data.user.id,
            email: data.user.email,
            is_job_digest_active: true,
            is_promotion_active: true,
          });

        if (invitedUserError) {
          throw new Error("Error creating record for invited user.");
        }
      }

      const userName =
        referrerData.full_name ||
        (referrerData.email ? referrerData.email.split("@")[0] : "");
      const inviteUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=signup&next=${finalRedirectUrl}`;

      const emailHtml = await render(
        <InviteUserEmail userName={userName} inviteUrl={inviteUrl} />,
      );

      const emailText = await render(
        <InviteUserEmail userName={userName} inviteUrl={inviteUrl} />,
        {
          plainText: true,
        },
      );

      await sendEmail({
        toEmail: invitedEmail,
        subject: `You are Invited by ${userName} to Join GetHired`,
        htmlContent: emailHtml,
        textContent: emailText,
      });

      const { error: userInfoError } = await serviceRoleSupabase
        .from("invitations")
        .insert({
          referrer_user_id: referrerUserId,
          invited_email: invitedEmail,
        });

      if (userInfoError) throw new Error("Error inserting Invitation record.");

      const { error: userUpdateError } = await serviceRoleSupabase
        .from("user_info")
        .update({
          invitations_count: referrerData.invitations_count + 1,
        })
        .eq("user_id", referrerUserId);

      if (userUpdateError) throw new Error("Error updating referrer record.");

      return {
        success: true,
        message: "Invitation sent successfully.",
      };
    }
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while sending user invite email.";
    await eventCaptureServerException({
      error: err,
      distinctId: referrerUserId,
      properties: { flow: "send_invite_credit_email" },
    });
    return {
      success: false,
      error,
    };
  }
}
