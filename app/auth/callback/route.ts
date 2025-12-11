import { handleUserUpsert } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Set a default redirect path (without the flag initially)
  let next = searchParams.get("next") ?? "/jobs";

  // Ensure 'next' is a safe, internal path
  if (!next.startsWith("/")) {
    next = "/jobs";
  }
  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        throw new Error("Auth code exchange failed");
        // Auth exchange failed (e.g., expired code, network issue)
        // console.error("Auth code exchange failed:", error?.message);
        // return NextResponse.redirect(`${origin}/auth/error`);
      }

      const { metadataUpdated, error: upsertUserError } =
        await handleUserUpsert(data.user);

      if (upsertUserError) {
        throw upsertUserError;
      }

      let finalRedirectPath = next;

      // Only append the parameter if the metadata was successfully updated
      if (metadataUpdated) {
        if (finalRedirectPath.includes("?")) {
          finalRedirectPath += "&metadata_updated=true";
        } else {
          finalRedirectPath += "?metadata_updated=true";
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${finalRedirectPath}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(
          `https://${forwardedHost}${finalRedirectPath}`
        );
      } else {
        return NextResponse.redirect(`${origin}${finalRedirectPath}`);
      }
    } catch {
      return NextResponse.redirect(`${origin}/auth/error`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
