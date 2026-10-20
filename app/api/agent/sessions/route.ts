import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalError, readJson, requireAgentUser } from "@/helpers/agent/auth";
import { sessionRoleFields } from "@/helpers/agent/persistence";

const SESSION_COLUMNS = "id, title, updated_at";

const createSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

export async function GET() {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase, role } = auth;

  let query = supabase.from("agent_sessions").select(SESSION_COLUMNS).eq("user_id", user.id);
  if (role === "company") query = query.eq("role", role);
  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) return internalError(error, user.id, "agent_sessions_list");
  return NextResponse.json({ sessions: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase, role } = auth;

  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Title must be 1 to 80 characters." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agent_sessions")
    .insert({
      user_id: user.id,
      ...sessionRoleFields(role),
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) return internalError(error, user.id, "agent_sessions_create");
  return NextResponse.json({ session: data }, { status: 201 });
}
