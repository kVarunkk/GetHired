import { handleUserUpsert } from "@/utils/auth-handlers";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { APPLICANT_HOME } from "@/helpers/user/home-path";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? APPLICANT_HOME;

  if (!next.startsWith("/")) {
    next = APPLICANT_HOME;
  }
  if (code) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        throw new Error("Auth code exchange failed");
      }

      const { metadataUpdated, error: upsertUserError } =
        await handleUserUpsert(data.user);

      if (upsertUserError) {
        throw upsertUserError;
      }

      let finalRedirectPath = next;

      if (metadataUpdated) {
        if (finalRedirectPath.includes("?")) {
          finalRedirectPath += "&metadata_updated=true";
        } else {
          finalRedirectPath += "?metadata_updated=true";
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const forwardedProto = request.headers.get("x-forwarded-proto");

      if (forwardedHost) {
        return NextResponse.redirect(
          `${forwardedProto ?? "https"}://${forwardedHost}${finalRedirectPath}`,
        );
      }
      return NextResponse.redirect(`${origin}${finalRedirectPath}`);
    } catch {
      return NextResponse.redirect(`${origin}/auth/error`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
