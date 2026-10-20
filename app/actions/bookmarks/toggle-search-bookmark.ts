"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

// An in-app search page: a path and query, never another origin.
const inputSchema = z
  .object({ url: z.string().max(2000).regex(/^\/(?!\/)/, "Not an in-app link.") })
  .strict();

export type ToggleSearchBookmarkResult = { ok: true; bookmarked: boolean } | { ok: false; error: string };

/** SERVER ACTION: saves the search at `url` for the session user, or removes it if it's already saved. */
export async function toggleSearchBookmarkAction(
  input: z.input<typeof inputSchema>,
): Promise<ToggleSearchBookmarkResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };
  const { url } = parsed.data;

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("url", url)
    .limit(1);
  if (readError) return { ok: false, error: "Couldn't update the bookmark. Please try again." };

  if (existing && existing.length > 0) {
    const { error } = await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("url", url);
    if (error) return { ok: false, error: "Couldn't remove the bookmark. Please try again." };
    return { ok: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("bookmarks")
    .insert({ user_id: user.id, url, name: `Saved Search ${crypto.randomUUID()}` });
  if (error) return { ok: false, error: "Couldn't save the bookmark. Please try again." };
  return { ok: true, bookmarked: true };
}
