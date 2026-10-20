import { NextResponse } from "next/server";
import { internalError, requireAgentUser } from "@/helpers/agent/auth";
import { listMemories } from "@/helpers/agent/memory";

export async function GET() {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    return NextResponse.json({ memories: await listMemories(supabase, user.id) });
  } catch (error) {
    return internalError(error, user.id, "agent_memories_list");
  }
}
