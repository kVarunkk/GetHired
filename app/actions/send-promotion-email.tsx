"use server";

import { Resend } from "resend";
import { render } from "@react-email/components";
import { PromotionEmail } from "@/emails/PromotionEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a promotional email to all users who have 'is_promotion_active' set to true.
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
  // Use the Service Role Client to bypass RLS and fetch all user data securely
  const supabase = createServiceRoleClient();

  // 1. Fetch Users Opted In
  const { data: users, error: fetchError } = await supabase
    .from("user_info")
    .select("user_id, email, full_name") // Select necessary fields
    .eq("is_promotion_active", true)
    .eq("filled", true); // Filter for active promotions
  // .eq("user_id", "4e6d6c65-ced7-4ec0-b51d-21a850cb1b1f");

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

  // 2. Prepare Email Sending Promises
  const emailPromises = users.map(async (user) => {
    // NOTE: Replace 'name' with a fallback if your user_info table doesn't have a 'name' field
    const userName = user.full_name || user.email.split("@")[0];

    const emailHtml = await render(
      <PromotionEmail
        userName={userName}
        emailTitle={promoDetails.title}
        mainContent={promoDetails.content}
        gifPreviewImageUrl={promoDetails.imageLink}
        ctaLink={promoDetails.ctaLink}
        ctaLabel={promoDetails.ctaLabel}
      />
    );

    // FIX: Standardize the return structure for both success and failure
    try {
      await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>", // Use a dedicated sender
        to: [user.email],
        subject: promoDetails.title,
        html: emailHtml,
      });

      // Standardized success return
      return { success: true, email: user.email, emailHtml: emailHtml };
    } catch (err) {
      // Catch individual send failures and allow others to continue
      console.error(`Failed to send email to ${user.email}:`, err);
      // Standardized failure return
      return { success: false, email: user.email };
    }
  });

  // 3. Execute all sends in parallel
  const results = await Promise.all(emailPromises);
  console.log(results);
  const successCount = results.filter((r) => r.success).length;

  return { success: true, count: successCount };
}

// LAST PROMOTION CONTENT

// export default function Test() {
//   const htmlContent = `<Section
//       style={{
//         paddingLeft: "20px",
//         backgroundColor: "#f9fafb",
//         borderRadius: "8px",
//       }}
//         className="text-base"
//       // className="py-4 px-6 border border-gray-200"
//     >
//       <Text>
//         We’ve completely re-engineered our recommendation engine to help you
//         find your dream role faster than ever.
//       </Text>

//       <ul style={{ margin: "0", paddingLeft: "20px", listStyleType: "disc" }}>
//         <li style={{ paddingBottom: "10px" }}>
//           <Text className="m-0">
//             <b>Instant Results:</b> No more waiting for "AI is thinking." We now
//             pre-compute your matches so your personalized feed loads instantly.
//           </Text>
//         </li>

//         <li style={{ paddingBottom: "10px" }}>
//           <Text className="m-0">
//             <b>Higher Precision:</b> By increasing our embedding dimensions, our
//             AI now understands the nuances of your skills and experience with
//             pinpoint accuracy.
//           </Text>
//         </li>

//         <li style={{ paddingBottom: "10px" }}>
//           <Text className="m-0">
//             <b>Zero-Latency Discovery:</b> Explore hundereds of jobs with a feed
//             that adapts to you in real-time.
//           </Text>
//         </li>
//       </ul>
//     </Section>`.replace(/\n/g, "");
//   const sendemail = async () => {
//     const promoDetails = {
//       title: "AI Smart Search is now 10x Faster and 5x More Relevant!",
//       content: htmlContent,
//       ctaLink: "https://gethired.devhub.co.in/jobs?sortBy=relevance",
//       ctaLabel: "View My Matches",
//       imageLink:
//         "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/promotional_emails/Screenshot%202026-01-03%20205319.png",
//     };
//     await sendPromotionEmails(promoDetails);
//   };

//   return <button onClick={sendemail}>send email</button>;
// }
