"use server";

import InviteUserEmail from "@/emails/InviteUserEmail";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { v4 as uuidv4 } from "uuid";

const productionUrl = "https://gethired.devhub.co.in";
const URL =
  process.env.NODE_ENV === "production"
    ? productionUrl
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInviteEmail(
  invitedEmail: string,
  referrerUserId: string
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
    if (referrerData.invitations_count >= 5) {
      throw new Error("Invitation limit reached for this week.");
    }
    const referralCode = referrerData.referral_code;

    const finalRedirectUrl = `/get-started?edit=true&ref=${referralCode}`;

    const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
      type: "signup",
      email: invitedEmail,
      password: uuidv4(),
    });

    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Invite link."
      );
    } else {
      const { error: invitedUserError } = await serviceRoleSupabase
        .from("user_info")
        .insert({
          user_id: data.user?.id,
          email: data.user?.email,
          is_job_digest_active: true,
          is_promotion_active: true,
          // invited_by: referrerUserId,
        });

      if (invitedUserError) {
        throw new Error("Error creating record for invited user.");
      }

      const userName =
        referrerData.full_name ?? referrerData.email.split("@")[0];
      const inviteUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=signup&next=${finalRedirectUrl}`;

      const emailHtml = await render(
        <InviteUserEmail userName={userName} inviteUrl={inviteUrl} />
      );

      const emailText = await render(
        <InviteUserEmail userName={userName} inviteUrl={inviteUrl} />,
        {
          plainText: true,
        }
      );

      const { error } = await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
        to: [invitedEmail],
        subject: `You are Invited by ${userName} to Join GetHired`,
        html: emailHtml,
        text: emailText,
      });

      if (error) throw new Error("Error sending invitation email.");

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
