import { tool } from "ai";
import { z } from "zod";
import {
  deleteMemory,
  memoryRef,
  resolveMemoryRef,
  upsertMemory,
} from "@/helpers/agent/memory";
import { AGENT_MEMORY_CATEGORIES, AGENT_MEMORY_MAX_CHARS } from "../config";
import { AgentToolContext, withToolErrors } from "./shared";

const NOT_FOUND = { error: "Memory not found." };

/** A memory's short id as the prompt shows it, or a full id from an older result. */
const memoryIdInput = z
  .string()
  .regex(/^[0-9a-f]{8}(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i)
  .describe("The memory's id, exactly as shown in brackets in the saved memories list.");

export function createMemoryTools(ctx: AgentToolContext) {
  return {
    saveMemory: tool({
      description:
        "Remember a durable fact about the user that their profile has no field for (e.g. companies to avoid, ongoing interviews). Pass memoryId to update an existing memory instead of adding a duplicate.",
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .max(AGENT_MEMORY_MAX_CHARS)
          .describe("The fact, written as a short statement about the user."),
        category: z.enum(AGENT_MEMORY_CATEGORIES),
        memoryId: memoryIdInput.optional().describe("Id of a saved memory to update."),
      }),
      execute: ({ content, category, memoryId }) =>
        withToolErrors(ctx, "saveMemory", async () => {
          let fullId: string | undefined;
          if (memoryId) {
            const resolved = await resolveMemoryRef(ctx.supabase, ctx.user.id, memoryId);
            if (!resolved) return NOT_FOUND;
            fullId = resolved;
          }

          const result = await upsertMemory(ctx.supabase, ctx.user.id, {
            content,
            category,
            memoryId: fullId,
            sessionId: ctx.sessionId,
          });
          if (!result.ok) return { error: result.error };

          const { id, category: savedCategory, content: savedContent } = result.memory;
          return {
            status: result.status,
            memory: { id: memoryRef(id), category: savedCategory, content: savedContent },
          };
        }),
    }),

    deleteMemory: tool({
      description: "Forget a saved memory that is no longer true.",
      inputSchema: z.object({ memoryId: memoryIdInput }),
      execute: ({ memoryId }) =>
        withToolErrors(ctx, "deleteMemory", async () => {
          const fullId = await resolveMemoryRef(ctx.supabase, ctx.user.id, memoryId);
          if (!fullId) return NOT_FOUND;

          const result = await deleteMemory(ctx.supabase, ctx.user.id, fullId);
          if (!result.ok) return { error: result.error };
          return { memoryId: memoryRef(fullId), deleted: true };
        }),
    }),
  };
}
