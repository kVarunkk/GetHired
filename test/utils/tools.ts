import { asSchema, type Tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { mockUser } from "./auth";

export function toolContext(
  supabase: SupabaseClient<Database>,
  overrides: Partial<AgentToolContext> = {},
): AgentToolContext {
  return {
    supabase,
    user: mockUser({ id: "u1", email: "ada@example.com" }),
    sessionId: "s1",
    ...overrides,
  };
}

/** Validates `input` with the tool's schema, as the AI SDK does. */
export async function validateInput(tool: Tool, input: unknown) {
  return asSchema(tool.inputSchema).validate!(input);
}

/** The tool's input JSON schema, as sent to the model. */
export async function inputJsonSchema(tool: Tool) {
  return (await asSchema(tool.inputSchema).jsonSchema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/** Validates `input` like the AI SDK, then runs the tool's `execute`. */
export async function execTool(tool: Tool, input: unknown) {
  const validation = await validateInput(tool, input);
  if (!validation.success) throw validation.error;
  return tool.execute!(validation.value, {
    toolCallId: "call-1",
    messages: [],
    context: undefined,
  });
}
