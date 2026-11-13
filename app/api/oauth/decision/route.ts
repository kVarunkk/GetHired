// app/api/oauth/decision/route.ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * The consent form POSTs here. The redirect back to the client must be a 303
 * so the browser follows it with a GET: NextResponse.redirect defaults to 307,
 * which repeats the POST, and claude.ai's /api/mcp/auth_callback answers a
 * POST with 405 Method Not Allowed.
 */
const SEE_OTHER = 303;

export async function POST(request: Request) {
  const formData = await request.formData();
  const decision = formData.get("decision");
  const authorizationId = formData.get("authorization_id") as string;

  if (!authorizationId) {
    return NextResponse.json(
      { error: "Missing authorization_id" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data, error } =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.redirect(data.redirect_url, SEE_OTHER);
}
