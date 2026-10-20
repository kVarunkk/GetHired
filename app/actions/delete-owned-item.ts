"use server";

import { z } from "zod";
import { OWNED_ITEM_TABLES } from "@/helpers/owned-items/owned-items";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ table: z.enum(OWNED_ITEM_TABLES), id: z.string().uuid() }).strict();

export type DeleteOwnedItemResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: deletes one of the session user's own rows from an allowlisted table (`OWNED_ITEM_FIELDS`). */
export async function deleteOwnedItemAction(input: z.input<typeof inputSchema>): Promise<DeleteOwnedItemResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const { table, id } = parsed.data;

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error || !deleted || deleted.length === 0) {
    return { ok: false, error: "Could not delete. Please try again later." };
  }

  return { ok: true };
}
