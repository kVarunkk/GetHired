import { createVertex } from "@ai-sdk/google-vertex";
import { User } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";
import { createServiceRoleClient } from "../lib/supabase/service-role";
import { Resend } from "resend";
import { updateUserAppMetadata } from "@/app/actions/update-user-metadata";
import { BrevoClient } from "@getbrevo/brevo";

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
  variant: "variant1" | "variant2",
  dateString?: string | null,
): string {
  if (!dateString) return variant === "variant2" ? "0" : "Unknown";
  const date = new Date(dateString);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
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
    // const supabase = await createClient();
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
          // Critical failure, throw immediately
          throw new Error(`DB insert failed: ${insertError.message}`);
        }
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
      `Fatal error during user upsert for ${user.id}: ${errorMessage}`,
    );
    return {
      metadataUpdated: false,
      error: errorMessage,
    };
  }
}

const REFERRAL_CREDITS = 10;

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
      console.log(
        `Successfully granted ${REFERRAL_CREDITS} credits to ${referrerId} for referral and updated invitation status.`,
      );
    }
  }
}

export const sendEmailForStatusUpdate = async (emailText: string) => {
  try {
    await sendEmail({
      toEmail: "varunkumawatleap2@gmail.com",
      subject: `Important: Status Update`,
      htmlContent: `<p>${emailText}</p>`,
      textContent: emailText,
    });
  } catch {
    console.error(
      "Some error occured while sending status update email to Varun Kumawat",
    );
  }
};

export const deploymentUrl = () => {
  switch (process.env.VERCEL_ENV) {
    case "production":
      return "https://gethired.devhub.co.in";
    case "preview":
      return `https://${process.env.VERCEL_URL}`;
    default:
      return "http://localhost:3000";
  }
};

export const parseMultiSelectParam = <T extends string>(
  param: string | null | undefined,
): T[] => {
  return param
    ? (param
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean) as T[])
    : [];
};

export const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";

export async function getJobCount(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("all_jobs")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("Failed to fetch job count:", error);
    return 6000;
  }

  return count ?? 0;
}

export async function sendEmail({
  toEmail,
  subject,
  htmlContent,
  textContent,
}: {
  toEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}) {
  try {
    const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY || "" });
    await brevo.transactionalEmails.sendTransacEmail({
      subject,
      htmlContent,
      sender: { name: "Varun from GetHired", email: "varun@devhub.co.in" },
      to: [{ email: toEmail }],
    });
  } catch (brevoError) {
    console.error("Brevo failed, trying Resend fallback:", brevoError);
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>",
        to: [toEmail],
        subject,
        html: htmlContent,
        text: textContent,
      });
    } catch (resendError) {
      console.error("Resend fallback also failed:", resendError);
      throw new Error(`Email delivery failed to ${toEmail}: ${resendError}`);
    }
  }
}

export const buildSalaryRange = (
  currency?: string,
  salary_min?: number,
  salary_max?: number,
) => {
  if (currency && salary_min && salary_max) {
    return `${currency}${salary_min} - ${currency}${salary_max}`;
  } else return null;
};

export const buildEquityRange = (equity_min?: number, equity_max?: number) => {
  if (equity_max && equity_min) {
    return `${equity_min}% - ${equity_max}%`;
  } else if (!equity_max && equity_min) {
    return `${equity_min}% +`;
  } else return null;
};

export const buildExperience = (exp_min?: number, exp_max?: number) => {
  if (exp_max && exp_min) {
    return `${exp_min} - ${exp_max} Years`;
  } else if (!exp_max && exp_min) {
    return `${exp_min}+ Years`;
  } else return null;
};
