import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalError, isUuid, readJson, requireAgentUser } from "@/helpers/agent/auth";
import { deleteMemory, upsertMemory } from "@/helpers/agent/memory";
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_MAX_CHARS,
  type AgentMemoryCategory,
} from "@/helpers/agent/config";

type Params = { params: Promise<{ memory_id: string }> };

const notFound = () => NextResponse.json({ error: "Memory not found." }, { status: 404 });

const editSchema = z
  .object({
    content: z.string().max(AGENT_MEMORY_MAX_CHARS).optional(),
    category: z.enum(AGENT_MEMORY_CATEGORIES).optional(),
  })
  .refine((body) => body.content !== undefined || body.category !== undefined);

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { memory_id: memoryId } = await params;
  if (!isUuid(memoryId)) return notFound();

  const parsed = editSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid memory update." }, { status: 400 });
  }

  try {
    const { data: existing, error } = await supabase
      .from("agent_memories")
      .select("content, category")
      .eq("id", memoryId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!existing) return notFound();

    // Edited by the user, outside a session: keeps the original source session.
    const result = await upsertMemory(supabase, user.id, {
      content: parsed.data.content ?? existing.content,
      category: parsed.data.category ?? (existing.category as AgentMemoryCategory),
      memoryId,
      sessionId: null,
    });

    if (!result.ok) {
      return result.error === "Memory not found."
        ? notFound()
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ memory: result.memory });
  } catch (error) {
    return internalError(error, user.id, "agent_memory_edit");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAgentUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { memory_id: memoryId } = await params;
  if (!isUuid(memoryId)) return notFound();

  try {
    const result = await deleteMemory(supabase, user.id, memoryId);
    if (!result.ok) return notFound();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return internalError(error, user.id, "agent_memory_delete");
  }
}
