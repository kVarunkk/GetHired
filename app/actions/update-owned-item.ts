"use server";

import { z } from "zod";
import { OWNED_ITEM_FIELDS, OWNED_ITEM_TABLES } from "@/helpers/owned-items/owned-items";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({
    table: z.enum(OWNED_ITEM_TABLES),
    id: z.string().uuid(),
    values: z.record(z.string(), z.string()),
  })
  .strict();

export type UpdateOwnedItemResult = { ok: true; values: Record<string, string> } | { ok: false; error: string };

/**
 * SERVER ACTION: edits the allowlisted fields (`OWNED_ITEM_FIELDS`) of one of
 * the session user's own rows. Replaces the browser's generic table update.
 */
export async function updateOwnedItemAction(input: z.input<typeof inputSchema>): Promise<UpdateOwnedItemResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const { table, id } = parsed.data;

  const values = OWNED_ITEM_FIELDS[table].safeParse(parsed.data.values);
  if (!values.success) {
    return { ok: false, error: values.error.issues[0]?.message ?? "Check the fields and try again." };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from(table)
    .update(values.data)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error || !updated || updated.length === 0) return { ok: false, error: "Couldn't save the changes." };

  return { ok: true, values: values.data };
}
