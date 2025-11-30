import { createClient } from "@/lib/supabase/server";
import { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

async function handleUserUpsert(user: User) {
  const supabase = await createClient();
  const { data: userData } = await supabase
    .from("user_info")
    .select("user_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!userData || userData.length === 0) {
    console.log(`OAuth: Inserting new user_info row for ID: ${user.id}`);

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
    }
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/")) {
    next = "/";
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await handleUserUpsert(data.user);
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
