"use server";

import AuthConfirmationEmail from "@/emails/AuthConfirmationEmail";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { render } from "@react-email/components";
import { Resend } from "resend";

const productionUrl = "https://gethired.devhub.co.in";
const URL =
  process.env.NODE_ENV === "production"
    ? productionUrl
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendSignupEmail(
  email: string,
  password: string,
  isCompany: boolean
) {
  try {
    const serviceRoleSupabase = createServiceRoleClient();

    const { data: existingUsers } = await serviceRoleSupabase
      .from("user_info")
      .select("user_id")
      .eq("email", email);
    if (existingUsers && existingUsers.length > 0) {
      throw new Error("This user is already registered. Please Login.");
    }

    const finalRedirectUrl = isCompany
      ? "/get-started?company=true&edit=true"
      : "/get-started?edit=true";

    const { data, error } = await serviceRoleSupabase.auth.admin.generateLink({
      type: "signup",
      email: email,
      password: password,
    });

    if (error || !data || !data.properties || !data.user) {
      throw new Error(
        error ? error.message : "Error occured while creating Signup link."
      );
    } else {
      const dataToAdd = isCompany
        ? {
            user_id: data.user?.id,
          }
        : {
            user_id: data.user?.id,
            email: email,
            is_job_digest_active: true,
            is_promotion_active: true,
          };
      const { error: signupUserError } = await serviceRoleSupabase
        .from(isCompany ? "company_info" : "user_info")
        .insert(dataToAdd);

      if (signupUserError) {
        throw new Error("Error creating record for new user.");
      }

      const signupUrl = `${URL}/auth/confirm?token_hash=${data.properties.hashed_token}&type=signup&next=${finalRedirectUrl}`;

      const emailHtml = await render(
        <AuthConfirmationEmail signupUrl={signupUrl} />
      );

      const emailText = await render(
        <AuthConfirmationEmail signupUrl={signupUrl} />,
        {
          plainText: true,
        }
      );

      const { error } = await resend.emails.send({
        from: "GetHired <varun@devhub.co.in>", // Use a clean, dedicated sender email
        to: [email],
        subject: `Confirm your Signup to GetHired`,
        html: emailHtml,
        text: emailText,
      });

      if (error) throw new Error("Error sending invitation email.");

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
