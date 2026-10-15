import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalError, isUuid, readJson, requireAgentUser } from "@/helpers/agent/auth";
import { loadSession } from "@/helpers/agent/persistence";

type Params = { params: Promise<{ session_id: string }> };

const notFound = () => NextResponse.json({ error: "Session not found." }, { status: 404 });

const renameSchema = z.object({ title: z.string().trim().min(1).max(80) });

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase, role } = auth;

  const { session_id: sessionId } = await params;
  if (!isUuid(sessionId)) return notFound();

  try {
    const loaded = await loadSession(supabase, user.id, sessionId, { role });
    if (!loaded) return notFound();
    return NextResponse.json(loaded);
  } catch (error) {
    return internalError(error, user.id, "agent_session_get");
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { session_id: sessionId } = await params;
  if (!isUuid(sessionId)) return notFound();

  const parsed = renameSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Title must be 1 to 80 characters." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agent_sessions")
    .update({ title: parsed.data.title })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .select("id, title, updated_at")
    .maybeSingle();

  if (error) return internalError(error, user.id, "agent_session_rename");
  if (!data) return notFound();
  return NextResponse.json({ session: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { session_id: sessionId } = await params;
  if (!isUuid(sessionId)) return notFound();

  const { data, error } = await supabase
    .from("agent_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .select("id");

  if (error) return internalError(error, user.id, "agent_session_delete");
  if (!data || data.length === 0) return notFound();
  return new NextResponse(null, { status: 204 });
}
