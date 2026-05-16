import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hashToken } from "@/utils/edgeUtils";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await request.json();

  if (!name) {
    return NextResponse.json(
      { error: "Please enter a valid name" },
      { status: 500 },
    );
  }

  // Generate token — shown to user only once
  const token = `gh_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await hashToken(token);

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.from("user_api_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    name: name,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return raw token once — never stored, only hash is kept
  return NextResponse.json({ token });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await request.json();
  await supabase
    .from("user_api_tokens")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
