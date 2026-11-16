import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { refreshAccessToken } from "./google-oauth";
import { CalendarError, isCalendarError } from "./provider";
import { sendCalendarReconnectEmail } from "./reconnect-email";
import { decryptToken, encryptToken } from "./token-crypto";

// Spec §4 "Refreshing": every Calendar API call gets its access token here.
// The token is cached encrypted in calendar_tokens, not in memory, because
// Cloud Run runs several instances and the crons run apart. Always called
// with the service role.

type Admin = SupabaseClient<Database>;

/** A cached token is used only while it has more than this left. */
export const ACCESS_TOKEN_MIN_LIFETIME_MS = 5 * 60_000;

/**
 * §4 Failures: the refresh token is dead. The connection becomes `error`,
 * both tokens are deleted, and the member is emailed once per error.
 */
export async function markConnectionBroken(
  admin: Admin,
  connection: { id: string; user_id: string },
  code: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("calendar_connections")
    .update({ status: "error", last_error: code.slice(0, 200), updated_at: now })
    .eq("id", connection.id);
  await admin.from("calendar_tokens").delete().eq("connection_id", connection.id);
  const { data: claimed } = await admin
    .from("calendar_connections")
    .update({ reconnect_emailed_at: now })
    .eq("id", connection.id)
    .is("reconnect_emailed_at", null)
    .select("id")
    .maybeSingle();
  reportError("[calendar] connection broken", connection.id, code);
  if (claimed) await sendCalendarReconnectEmail(connection.user_id);
}

/** The connection's access token, refreshed when it has 5 minutes or less left (or when `force`d). */
export async function getAccessToken(
  admin: Admin,
  connectionId: string,
  { force = false }: { force?: boolean } = {},
): Promise<string> {
  const { data: connection, error } = await admin
    .from("calendar_connections")
    .select("id, user_id, status")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new CalendarError("error", null, "load_connection");
  if (!connection || connection.status !== "active") throw new CalendarError("invalid_grant", null, "not_connected");

  const { data: tokens, error: tokensError } = await admin
    .from("calendar_tokens")
    .select("refresh_token_enc, access_token_enc, access_token_expires_at, key_version")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (tokensError) throw new CalendarError("error", null, "load_tokens");
  if (!tokens) throw new CalendarError("invalid_grant", null, "no_tokens");

  const binding = { connectionId, userId: connection.user_id };
  const expiresAt = tokens.access_token_expires_at ? Date.parse(tokens.access_token_expires_at) : 0;
  if (!force && tokens.access_token_enc && expiresAt - Date.now() > ACCESS_TOKEN_MIN_LIFETIME_MS) {
    return decryptToken(tokens.access_token_enc, { ...binding, kind: "access" });
  }

  const refreshToken = decryptToken(tokens.refresh_token_enc, { ...binding, kind: "refresh" });
  let fresh: { accessToken: string; expiresIn: number };
  try {
    fresh = await refreshAccessToken(refreshToken);
  } catch (err) {
    if (isCalendarError(err, "invalid_grant")) {
      await markConnectionBroken(admin, connection, "invalid_grant");
    }
    throw err;
  }

  // Two refreshes at once are harmless: both tokens work and the last write wins.
  const sealed = encryptToken(fresh.accessToken, { ...binding, kind: "access" });
  const now = Date.now();
  const { error: writeError } = await admin
    .from("calendar_tokens")
    .update({
      access_token_enc: sealed.value,
      access_token_expires_at: new Date(now + fresh.expiresIn * 1000).toISOString(),
      // The refresh token isn't re-sealed here, so both share a version only
      // after the next reconnect; decryption reads each value's own prefix.
      key_version: sealed.keyVersion,
      refreshed_at: new Date(now).toISOString(),
    })
    .eq("connection_id", connectionId);
  if (writeError) reportError("[calendar] couldn't cache the access token", connectionId, writeError.code);
  return fresh.accessToken;
}

/** Runs `fn` with the connection's token; after a 401 it refreshes once and retries once. */
export async function withCalendarAuth<T>(
  admin: Admin,
  connectionId: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await getAccessToken(admin, connectionId));
  } catch (err) {
    if (!isCalendarError(err, "unauthorized")) throw err;
    return fn(await getAccessToken(admin, connectionId, { force: true }));
  }
}
