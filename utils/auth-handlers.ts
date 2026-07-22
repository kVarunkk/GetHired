import { updateUserAppMetadata } from "@/app/actions/update-user-metadata";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { User } from "@supabase/supabase-js";
import { PostHogEvent } from "./types";

const REFERRAL_CREDITS = 10;

export async function handleUserUpsert(user: User) {
  try {
    const supabase = createServiceRoleClient();

    const { data: userData, error: selectError } = await supabase
      .from("user_info")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1);

    if (selectError) {
      throw new Error(
        `DB select failed during upsert check: ${selectError.message}`,
      );
    }

    if (!userData || userData.length === 0) {
      console.log(`OAuth: Inserting new user_info row for ID: ${user.id}`);

      const { error: updateAppMetaError } = await updateUserAppMetadata(
        user.id,
        {
          type: "applicant",
          onboarding_complete: false,
        },
      );

      if (updateAppMetaError) {
        throw new Error(`Admin metadata update failed: ${updateAppMetaError}`);
      }
      if (user.email) {
        const newUserInfo = {
          user_id: user.id,
          email: user.email,
          is_job_digest_active: true,
          is_promotion_active: true,
        };

        const { error: insertError } = await supabase
          .from("user_info")
          .insert(newUserInfo);

        if (insertError) {
          console.error(
            "CRITICAL DB ERROR: Failed to insert new user_info row:",
            insertError,
          );
          throw new Error(`DB insert failed: ${insertError.message}`);
        }
      }

      await eventCaptureServer({
        event: PostHogEvent.SignupCompleted,
        distinctId: user.id,
        properties: {
          user_type: "applicant",
        },
      });

      return {
        metadataUpdated: true,
        error: null,
      };
    }
    return {
      metadataUpdated: false,
      error: null,
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(
      `Fatal error during user upsert for ${user.id}: ${errorMessage}`,
    );
    return {
      metadataUpdated: false,
      error: errorMessage,
    };
  }
}

export async function grantReferralCredits(
  referralCode: string,
  invited_email: string,
) {
  const supabase = createServiceRoleClient();
  const { data: referrerData, error: refError } = await supabase
    .from("user_info")
    .select("user_id, ai_credits")
    .eq("referral_code", referralCode)
    .limit(1)
    .single();

  if (refError || !referrerData) {
    console.warn(
      `Referral failed: Code ${referralCode} not found or user not active.`,
    );
    return;
  }

  const referrerId = referrerData.user_id;
  const ai_credits = referrerData.ai_credits;

  const { error: invitationsError } = await supabase
    .from("invitations")
    .update({
      status: "complete",
    })
    .eq("referrer_user_id", referrerId)
    .eq("invited_email", invited_email);

  if (invitationsError) {
    console.error("Error updating invitation status");
  } else {
    const { error: creditError } = await supabase
      .from("user_info")
      .update({
        ai_credits: ai_credits + REFERRAL_CREDITS,
      })
      .eq("user_id", referrerId);
    if (creditError) {
      console.error("Error granting credits to referrer");
    } else {
      await eventCaptureServer({
        event: PostHogEvent.ReferralCreditsGranted,
        distinctId: referrerId,
      });

      console.log(
        `Successfully granted ${REFERRAL_CREDITS} credits to ${referrerId} for referral and updated invitation status.`,
      );
    }
  }
}
