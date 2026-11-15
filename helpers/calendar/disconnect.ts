import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { googleCalendar } from "./google";
import { isCalendarError } from "./provider";
import { decryptToken } from "./token-crypto";

// Spec §4 "Removal" (IVT-036). Disconnecting revokes at Google and deletes
// both rows, even when the revoke fails. The member's future interviews show
// "Organizer disconnected" from then on: that's derived (an organizer
// without an active connection), so nothing else is written.
//
// Leaving the company, being removed and deleting the account delete the
// connection in the database (calendar_member_left), which keeps the refresh
// token in calendar_pending_revocations; revokePendingCalendars revokes those.

type Admin = SupabaseClient<Database>;

/** A pending revocation is dropped after this many failed tries. */
export const MAX_REVOKE_ATTEMPTS = 5;
const REVOKE_BATCH = 50;

const codeOf = (err: unknown) => (isCalendarError(err) ? `${err.code}:${err.status ?? ""}` : "error");

/** The session member's own disconnect. Always with the service role. */
export async function disconnectCalendar(admin: Admin, userId: string): Promise<{ ok: true; revoked: boolean }> {
  const { data: connections, error } = await admin
    .from("calendar_connections")
    .select("id, user_id")
    .eq("user_id", userId);
  if (error) throw new Error("Couldn't load the calendar connection");
  if (!connections?.length) return { ok: true, revoked: false };

  const ids = connections.map((c) => c.id);
  const { data: tokens } = await admin
    .from("calendar_tokens")
    .select("connection_id, refresh_token_enc")
    .in("connection_id", ids);

  let revoked = (tokens ?? []).length > 0;
  for (const t of tokens ?? []) {
    try {
      const token = decryptToken(t.refresh_token_enc, { connectionId: t.connection_id, userId, kind: "refresh" });
      await googleCalendar.revoke(token);
    } catch (err) {
      revoked = false;
      reportError("[calendar] revoke on disconnect failed", t.connection_id, codeOf(err));
    }
  }

  // Tokens first, so the delete trigger doesn't queue them for revocation again.
  await admin.from("calendar_tokens").delete().in("connection_id", ids);
  const { error: deleteError } = await admin.from("calendar_connections").delete().eq("user_id", userId);
  if (deleteError) throw new Error("Couldn't remove the calendar connection");
  return { ok: true, revoked };
}

/** Revokes the refresh tokens of connections deleted without a disconnect. Service role. */
export async function revokePendingCalendars(admin: Admin): Promise<{ revoked: number; failed: number; gaveUp: number }> {
  const { data, error } = await admin
    .from("calendar_pending_revocations")
    .select("connection_id, user_id, provider, refresh_token_enc, attempts")
    .order("created_at", { ascending: true })
    .limit(REVOKE_BATCH);
  if (error) throw new Error("Couldn't read the pending revocations");

  let revoked = 0;
  let failed = 0;
  let gaveUp = 0;
  for (const row of data ?? []) {
    const drop = () => admin.from("calendar_pending_revocations").delete().eq("connection_id", row.connection_id);
    let token: string;
    try {
      token = decryptToken(row.refresh_token_enc, { connectionId: row.connection_id, userId: row.user_id, kind: "refresh" });
    } catch {
      reportError("[calendar] pending revocation can't be decrypted; dropped", row.connection_id);
      await drop();
      gaveUp++;
      continue;
    }
    try {
      await googleCalendar.revoke(token);
      await drop();
      revoked++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_REVOKE_ATTEMPTS) {
        reportError("[calendar] gave up revoking", row.connection_id, codeOf(err));
        await drop();
        gaveUp++;
      } else {
        await admin.from("calendar_pending_revocations").update({ attempts }).eq("connection_id", row.connection_id);
        failed++;
      }
    }
  }
  return { revoked, failed, gaveUp };
}
