"use server";

import InviteUserEmail from "@/emails/InviteUserEmail";
import { deploymentUrl, sendEmail } from "@/utils/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { v4 as uuidv4 } from "uuid";
import { updateUserAppMetadata } from "./update-user-metadata";

const URL = deploymentUrl();

export async function sendInviteEmail(
  invitedEmail: string,
  referrerUserId: string,
) {
  try {
    const supabase = await createClient();
    const serviceRoleSupabase = createServiceRoleClient();

    const { data: existingUsers } = await serviceRoleSupabase
      .from("user_info")
      .select("user_id")
      .eq("email", invitedEmail);
    if (existingUsers && existingUsers.length > 0) {
      throw new Error("This user is already registered on GetHired.");
    }

    const { data: referrerData, error: refError } = await supabase
      .from("user_info")
      .select("referral_code, full_name, email, invitations_count")
      .eq("user_id", referrerUserId)
      .single();

    if (refError || !referrerData) {
      throw new Error("Failed to retrieve inviter's code.");
    }
    if (referrerData.invitations_count >= 10) {
      throw new Error("Invitation limit reached for this week.");
    }
    const referralCode = referrerData.referral_code;

    const finalRedirectUrl = `/jobs?ref=${referralCode}`;

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
      const { error: updateAppMetaError } = await updateUserAppMetadata(
        data.user?.id,
        {
          type: "applicant",
          onboarding_complete: false,
        },
      );

      if (updateAppMetaError) throw new Error(updateAppMetaError);

      const { error: invitedUserError } = await serviceRoleSupabase
        .from("user_info")
        .insert({
          user_id: data.user?.id,
          email: data.user?.email,
          is_job_digest_active: true,
          is_promotion_active: true,
        });

      if (invitedUserError) {
        throw new Error("Error creating record for invited user.");
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

      const { error: userInfoError } = await supabase
        .from("invitations")
        .insert({
          referrer_user_id: referrerUserId,
          invited_email: invitedEmail,
        });

      if (userInfoError) throw new Error("Error inserting Invitation record.");

      const { error: userUpdateError } = await supabase
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
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
