import { SupabaseClient } from "@supabase/supabase-js";
import { Database, Tables } from "@/utils/types/database.types";
import {
  AGENT_MAX_MEMORIES,
  AGENT_MEMORY_MAX_CHARS,
  type AgentMemoryCategory,
} from "./config";

type Client = SupabaseClient<Database>;

export type AgentMemory = Pick<
  Tables<"agent_memories">,
  "id" | "content" | "category" | "source_session_id" | "created_at" | "updated_at"
>;

export type UpsertMemoryResult =
  | { ok: true; status: "created" | "updated" | "existing"; memory: AgentMemory }
  | { ok: false; error: string };

const MEMORY_COLUMNS =
  "id, content, category, source_session_id, created_at, updated_at";

/** Length of the short memory ids shown to the model. */
const MEMORY_REF_LENGTH = 8;

/**
 * The short id the model sees for a memory: the first 8 characters of its
 * UUID. Unlike a list position, it never changes, so ids in earlier turns
 * stay valid.
 */
export const memoryRef = (memoryId: string) => memoryId.slice(0, MEMORY_REF_LENGTH);

/**
 * The full id of the user's memory with this short id (or full id). Returns
 * null when none matches, or when two share the short id, rather than
 * guessing. Database errors are thrown.
 */
export async function resolveMemoryRef(
  supabase: Client,
  userId: string,
  ref: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select("id")
    .eq("user_id", userId);
  if (error) throw error;

  const wanted = ref.toLowerCase();
  const matches = (data ?? []).filter((row) =>
    wanted.length > MEMORY_REF_LENGTH ? row.id === wanted : row.id.startsWith(wanted),
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** Strips HTML tags and collapses whitespace (SEC-004). */
export function sanitiseMemoryContent(content: string) {
  return content
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const normalise = (content: string) => content.toLowerCase().replace(/\s+/g, " ").trim();

/** The user's memories, most recently updated first. */
export async function listMemories(
  supabase: Client,
  userId: string,
): Promise<AgentMemory[]> {
  const { data, error } = await supabase
    .from("agent_memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates a memory, or updates the user's memory `memoryId` (REQ-010).
 * A new memory matching an existing one (ignoring case and whitespace)
 * returns that row instead of a duplicate. `updated_at` is maintained by a
 * database trigger. Database errors are thrown.
 */
export async function upsertMemory(
  supabase: Client,
  userId: string,
  {
    content: rawContent,
    category,
    memoryId,
    sessionId,
  }: {
    content: string;
    category: AgentMemoryCategory;
    memoryId?: string;
    sessionId: string | null;
  },
): Promise<UpsertMemoryResult> {
  const content = sanitiseMemoryContent(rawContent);
  if (content.length === 0 || content.length > AGENT_MEMORY_MAX_CHARS) {
    return {
      ok: false,
      error: `Memory content must be between 1 and ${AGENT_MEMORY_MAX_CHARS} characters.`,
    };
  }

  if (memoryId) {
    const { data, error } = await supabase
      .from("agent_memories")
      .update({
        content,
        category,
        ...(sessionId ? { source_session_id: sessionId } : {}),
      })
      .eq("id", memoryId)
      .eq("user_id", userId)
      .select(MEMORY_COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Memory not found." };
    return { ok: true, status: "updated", memory: data };
  }

  const { data: existing, error: listError } = await supabase
    .from("agent_memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId);

  if (listError) throw listError;

  const duplicate = existing?.find(
    (memory) => normalise(memory.content) === normalise(content),
  );
  if (duplicate) return { ok: true, status: "existing", memory: duplicate };

  if ((existing?.length ?? 0) >= AGENT_MAX_MEMORIES) {
    return {
      ok: false,
      error: `Memory limit of ${AGENT_MAX_MEMORIES} reached. Update an existing memory with its memoryId or delete one first.`,
    };
  }

  const { data, error } = await supabase
    .from("agent_memories")
    .insert({
      user_id: userId,
      content,
      category,
      source_session_id: sessionId,
    })
    .select(MEMORY_COLUMNS)
    .single();

  if (error) throw error;
  return { ok: true, status: "created", memory: data };
}

/** Deletes the user's memory `memoryId`. Database errors are thrown. */
export async function deleteMemory(
  supabase: Client,
  userId: string,
  memoryId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("agent_memories")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, error: "Memory not found." };
  return { ok: true };
}
