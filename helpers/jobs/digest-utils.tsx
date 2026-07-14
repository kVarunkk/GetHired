import JobDigestEmail from "@/emails/JobDigestEmail";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import { render } from "@react-email/components";
import { AllJobWithRelations, TAICredits } from "@/utils/types";
import { sendEmail } from "@/utils/email";
import { RelevanceJobMessage } from "@/app/api/updates/applicants/digest/worker/route";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

export async function getAllDigestUsers() {
  const supabase = createServiceRoleClient();

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysAgoISO = threeDaysAgo.toISOString();

  const { data, error } = await supabase
    .from("user_info")
    .select(
      `
            user_id, 
            email, 
            full_name, 
            ai_credits,
            preferred_locations
        `,
    )
    .neq("full_name", null)
    .eq("filled", true)
    .gte("ai_credits", TAICredits.AI_SEARCH_ASK_AI_RESUME)
    .eq("is_job_digest_active", true)
    .lt("created_at", threeDaysAgoISO);

  if (error) {
    console.error("Supabase Error fetching digest users:", error);
    throw new Error("Failed to fetch eligible users for digest.");
  }

  return data;
}

export async function processUserDigest(user: RelevanceJobMessage["message"]) {
  const URL = deploymentUrl();
  const params = new URLSearchParams();

  try {
    if (
      user.ai_credits < TAICredits.AI_SEARCH_ASK_AI_RESUME &&
      user.email &&
      user.full_name
    ) {
      console.log(`Skipped digest for ${user.email}: Insufficient AI credits.`);

      return {
        success: true,
        userEmail: user.email,
        jobs: [],
        msg: "Insufficient AI credits",
        isInsufficientCredits: true,
      };
    }

    const cutoffDays = "3";

    params.set("sortBy", "relevance");
    params.set("createdAfter", cutoffDays);
    params.set("userId", user.user_id);
    params.set("type", "digest");
    if (
      Array.isArray(user.preferred_locations) &&
      user.preferred_locations.length > 0
    ) {
      params.set("location", user.preferred_locations.join("|"));
    }

    const jobFetchRes = await fetch(`${URL}/api/jobs?${params.toString()}`, {
      headers: {
        "X-Internal-Secret": INTERNAL_API_SECRET || "",
      },
    });

    if (!jobFetchRes.ok) {
      throw new Error(
        `API jobs endpoint failed with status ${jobFetchRes.status}`,
      );
    }

    const result = await jobFetchRes.json();
    const finalJobs: AllJobWithRelations[] = result.data || [];

    return { success: true, userEmail: user.email, jobs: finalJobs };
  } catch (e) {
    console.error(`Error processing digest for user ${user?.email}:`, e);
    return {
      success: false,
      userEmail: user.email ?? "Unknown",
      msg: e instanceof Error ? e.message : "unknown error occured.",
    };
  }
}

export async function sendJobDigestEmail(
  email: string,
  userName: string,
  jobs: AllJobWithRelations[],
  digestDate: string,
  insufficientCredits: boolean = false,
) {
  const emailHtml = await render(
    <JobDigestEmail
      userName={userName}
      jobs={jobs}
      insufficientCredits={insufficientCredits}
    />,
  );

  const emailText = await render(
    <JobDigestEmail
      userName={userName}
      jobs={jobs}
      insufficientCredits={insufficientCredits}
    />,
    { plainText: true },
  );

  try {
    await sendEmail({
      toEmail: email,
      subject: `Your Daily Job Digest for ${digestDate}`,
      htmlContent: emailHtml,
      textContent: emailText,
    });

    console.log(`Successfully sent ${jobs.length} jobs to ${email}.`);
    return { success: true };
  } catch (e) {
    console.error(`Error sending email to ${email}:`, e);
    return { success: false, error: (e as Error).message };
  }
}
