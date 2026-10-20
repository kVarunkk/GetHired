"use server";

import { render } from "react-email";
import { PromotionEmail } from "@/emails/PromotionEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { isAdmin } from "@/helpers/user/is-admin";

/**
 * Sends a promotional email to all users who have 'is_promotion_active' set to true.
 * Admin-only (RS-F12): it emails users arbitrary content from our domain.
 * @param promoDetails Object containing the content for the email.
 * @returns Object indicating success or failure.
 */
export async function sendPromotionEmails(promoDetails: {
  title: string;
  content: string;
  ctaLink: string;
  ctaLabel: string;
  imageLink?: string;
}): Promise<{ success: boolean; count: number; error?: string }> {
  const user = await getUserFromRequest();
  if (!isAdmin(user)) {
    return { success: false, count: 0, error: "Unauthorized" };
  }

  const supabase = createServiceRoleClient();

  const { data: users, error: fetchError } = await supabase
    .from("user_info")
    .select("user_id, email, full_name")
    .eq("is_promotion_active", true)
    .eq("filled", true)
    .eq("email", "varunkumawatleap2@gmail.com");

  if (fetchError) {
    console.error("Error fetching promotional users:", fetchError);
    return { success: false, count: 0, error: fetchError.message };
  }

  if (!users || users.length === 0) {
    return {
      success: true,
      count: 0,
      error: "No active users found for promotion.",
    };
  }

  const emailPromises = users.map(async (user) => {
    const userName =
      user.full_name || (user.email ? user.email.split("@")[0] : "");

    const emailHtml = await render(
      <PromotionEmail
        userName={userName}
        emailTitle={promoDetails.title}
        mainContent={promoDetails.content}
        gifPreviewImageUrl={promoDetails.imageLink}
        ctaLink={promoDetails.ctaLink}
        ctaLabel={promoDetails.ctaLabel}
      />,
    );

    try {
      if (!user.email) {
        throw new Error("User email is missing.");
      }

      await sendEmail({
        toEmail: user.email,
        subject: promoDetails.title,
        htmlContent: emailHtml,
        textContent: promoDetails.content,
      });

      return { success: true, email: user.email, emailHtml: emailHtml };
    } catch (err) {
      console.error(`Failed to send email to ${user.email}:`, err);
      return { success: false, email: user.email };
    }
  });

  const results = await Promise.all(emailPromises);
  const successCount = results.filter((r) => r.success).length;

  return { success: true, count: successCount };
}
