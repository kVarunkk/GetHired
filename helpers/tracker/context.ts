import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/** The session's client and user. The user always comes from here, never from input. */
export type TrackerContext = {
  supabase: SupabaseClient<Database>;
  user: Pick<User, "id">;
};

export type TrackedRow = Database["public"]["Tables"]["tracked_applications"]["Row"];

export type TrackerSource = "board_prompt" | "manual" | "url" | "extension" | "agent" | "mcp" | "migrated";

export const isUniqueViolation = (error: { code?: string } | null | undefined) => error?.code === "23505";
export const isCapError = (error: { message?: string } | null | undefined) =>
  Boolean(error?.message?.includes("AT_MAX_TRACKED"));
