"use server";

import { z } from "zod";
import { canAlertOnUrl, MAX_BOOKMARK_ALERTS } from "@/helpers/bookmarks/limits";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { BookmarkRow } from "@/utils/types";

const inputSchema = z.object({ bookmarkId: z.string().uuid(), on: z.boolean() }).strict();

export type SetBookmarkAlertResult = { ok: true; bookmark: BookmarkRow } | { ok: false; error: string };

/** SERVER ACTION (BW-F07): turns weekly job alerts on or off for one of the session user's bookmarks. */
export async function setBookmarkAlertAction(
  input: z.input<typeof inputSchema>,
): Promise<SetBookmarkAlertResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bookmark not found." };
  const { bookmarkId, on } = parsed.data;

  const supabase = await createClient();
  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("id, url")
    .eq("id", bookmarkId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!bookmark) return { ok: false, error: "Bookmark not found." };

  if (on) {
    if (!canAlertOnUrl(bookmark.url)) {
      return { ok: false, error: "Alerts aren't available for relevance-sorted searches." };
    }
    const { count } = await supabase
      .from("bookmarks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_alert_on", true)
      .neq("id", bookmarkId);
    if ((count ?? 0) >= MAX_BOOKMARK_ALERTS) {
      return { ok: false, error: `You can only create a maximum of ${MAX_BOOKMARK_ALERTS} Alerts.` };
    }
  }

  const { data: updated, error } = await supabase
    .from("bookmarks")
    .update({ is_alert_on: on })
    .eq("id", bookmarkId)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error || !updated) return { ok: false, error: "Some error occured while updating the Alert Status." };

  return { ok: true, bookmark: updated };
}
