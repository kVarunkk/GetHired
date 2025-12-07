import { grantReferralCredits } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

const DEFAULT_REDIRECT_PATH = "/jobs";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let nextPathWithParams = searchParams.get("next") ?? DEFAULT_REDIRECT_PATH;

  let referralCode: string | null = null;

  try {
    const tempUrl = new URL(nextPathWithParams, origin);
    referralCode = tempUrl.searchParams.get("ref");
  } catch (e) {
    console.warn("Could not parse 'next' parameter for ref code:", e);
    nextPathWithParams = DEFAULT_REDIRECT_PATH;
  }

  const nextRedirectPath =
    nextPathWithParams.split("?")[0] || DEFAULT_REDIRECT_PATH;

  let next = nextRedirectPath;

  if (!next.startsWith("/")) {
    next = DEFAULT_REDIRECT_PATH;
  }

  if (token_hash && type) {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error && data.user) {
      // await handleUserUpsert(data.user);

      if (referralCode) {
        await grantReferralCredits(referralCode);
      }
      redirect(next);
    } else {
      redirect(`/auth/error?error=${error?.message}`);
    }
  }

  redirect(`/auth/error?error=No token hash or type`);
}
