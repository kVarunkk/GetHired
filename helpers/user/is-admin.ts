import type { User } from "@supabase/supabase-js";

/**
 * Whether a user may run admin-only actions: `app_metadata.role === "admin"`
 * (only server code writes app_metadata) or listed in the comma-separated
 * `ADMIN_USER_IDS` env var.
 */
export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.app_metadata?.role === "admin") return true;
  const ids = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.includes(user.id);
}
