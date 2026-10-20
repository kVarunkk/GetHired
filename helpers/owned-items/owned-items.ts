import { z } from "zod";

const name = z.string().trim().min(1).max(200);
// An in-app link: a path and query, never another origin.
const inAppUrl = z.string().trim().max(2000).regex(/^\/(?!\/)/, "Use a link from this site, starting with /.");

/**
 * The tables whose rows a user renames or deletes from their own lists
 * (`DynamicTableActions`), and the fields they may edit. Rows are always
 * matched on the session user's `user_id` as well as RLS.
 */
export const OWNED_ITEM_FIELDS = {
  resumes: z.object({ name }).strict(),
  resume_reviews: z.object({ name }).strict(),
  interviews: z.object({ name }).strict(),
  user_api_tokens: z.object({ name }).strict(),
  bookmarks: z.object({ name, url: inAppUrl }).strict(),
} as const;

export type OwnedItemTable = keyof typeof OWNED_ITEM_FIELDS;

export const OWNED_ITEM_TABLES = Object.keys(OWNED_ITEM_FIELDS) as [OwnedItemTable, ...OwnedItemTable[]];
