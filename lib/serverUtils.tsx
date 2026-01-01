import { createVertex } from "@ai-sdk/google-vertex";
import { User } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import { createClient } from "./supabase/server";
import { createServiceRoleClient } from "./supabase/service-role";
import { Resend } from "resend";
import { updateUserAppMetadata } from "@/app/actions/update-user-metadata";
import { render } from "@react-email/components";
import RelevantJobsSetupUpdateEmail from "@/emails/RelevantJobsSetupUpdateEmail";

export async function getVertexClient() {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  if (!credentialsJson) {
    throw new Error("GOOGLE_CREDENTIALS_JSON environment variable is not set.");
  }

  const tempFilePath = path.join("/tmp", "credentials.json");

  try {
    await fs.writeFile(tempFilePath, JSON.parse(`"${credentialsJson}"`));
  } catch {
    throw new Error("Failed to set up credentials for Vertex AI.");
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath;

  return createVertex({
    project: "mern-twitter-368919",
    location: "us-central1",
  });
}

export function getCutOffDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * Calculates the time elapsed since the date string, returning either "Today" or "X day(s) ago".
 * @param dateString The ISO timestamp string (e.g., job.created_at).
 * @returns A string like "Today", "1 day ago", or "5 days ago".
 */
export function simpleTimeAgo(
  dateString: string,
  variant: "variant1" | "variant2"
): string {
  const date = new Date(dateString);
  const now = new Date();

  // Normalize both dates to midnight (UTC or local, depending on preference)
  // to accurately calculate the day difference, ignoring time of day.

  // For consistency with server timestamps, we'll use local date components:
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  // Calculate difference in milliseconds
  const diffMs = startOfToday.getTime() - startOfDate.getTime();

  // Convert to days (1000 ms * 60 s * 60 min * 24 hr)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (variant === "variant2") {
    return diffDays.toString();
  }

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "1 day ago";
  }

  // For anything > 1 day
  return `${diffDays} days ago`;
}

export async function handleUserUpsert(user: User) {
  try {
    const supabase = await createClient();

    const { data: userData, error: selectError } = await supabase
      .from("user_info")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1);

    if (selectError) {
      throw new Error(
        `DB select failed during upsert check: ${selectError.message}`
      );
    }

    if (!userData || userData.length === 0) {
      console.log(`OAuth: Inserting new user_info row for ID: ${user.id}`);

      const { error: updateAppMetaError } = await updateUserAppMetadata(
        user.id,
        {
          type: "applicant",
          onboarding_complete: false,
        }
      );

      if (updateAppMetaError) {
        // Critical failure, throw immediately
        throw new Error(`Admin metadata update failed: ${updateAppMetaError}`);
      }
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
          insertError
        );
        // Critical failure, throw immediately
        throw new Error(`DB insert failed: ${insertError.message}`);
      }
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
      `Fatal error during user upsert for ${user.id}: ${errorMessage}`
    );
    return {
      metadataUpdated: false,
      error: errorMessage,
    };
    // throw new Error(`FATAL_UPSERT_FAILURE: ${errorMessage}`);
  }
}

const REFERRAL_CREDITS = 10;

export async function grantReferralCredits(
  referralCode: string,
  invited_email: string
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
      `Referral failed: Code ${referralCode} not found or user not active.`
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
      console.log(
        `Successfully granted ${REFERRAL_CREDITS} credits to ${referrerId} for referral and updated invitation status.`
      );
    }
  }
}

export const sendEmailForStatusUpdate = async (emailText: string) => {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    resend.emails.send({
      from: "GetHired <varun@devhub.co.in>",
      to: ["varunkumawatleap2@gmail.com"],
      subject: `Important: Status Update`,
      // html: emailHTML,
      text: emailText,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat"
    );
  }
};

export const sendEmailForRelevantJobsStatusUpdate = async (
  email: string,
  name: string,
  url: string
) => {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailHtml = await render(
      <RelevantJobsSetupUpdateEmail userName={name} inviteUrl={url} />
    );

    resend.emails.send({
      from: "GetHired <varun@devhub.co.in>",
      to: [email],
      subject: `Important: Your AI Smart Search Job Feed is ready!`,
      html: emailHtml,
      // text: email,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat"
    );
  }
};

export const deploymentUrl = () => {
  let url;
  switch (process.env.VERCEL_ENV) {
    case "production":
      url = "https://gethired.devhub.co.in";
      break;
    case "preview":
      url =
        "https://job-application-agent-frontend-git-dev-kvarunkks-projects.vercel.app";
      break;
    case "development":
      url = "http://localhost:3000";
      break;
  }
  return url;
};
