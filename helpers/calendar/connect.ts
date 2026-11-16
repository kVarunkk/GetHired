import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import type { CalendarConnectError } from "./copy";
import { SCOPE_EVENTS, SCOPE_FREEBUSY } from "./google-oauth";
import { MY_CALENDAR_PATH } from "./config";
import { encryptToken } from "./token-crypto";

// IVT-035 (spec §4 "Connect flow"): the pieces of the OAuth routes that don't
// need a request. Phase 2 ships dark behind CALENDAR_ENABLED until Google
// verifies the app (Q4).

/** Read at request time, so the flag can change without a rebuild. */
export const calendarEnabled = () => process.env.CALENDAR_ENABLED === "true";

/** Holds `<nonce>.<pkce verifier>` between connect and callback. */
export const OAUTH_COOKIE = "gh_calendar_oauth";
export const OAUTH_COOKIE_PATH = "/api/calendar/google";
export const STATE_TTL_MS = 10 * 60_000;

export type OAuthState = { userId: string; companyId: string; nonce: string; returnTo: string; exp: number };

function stateKey(): string {
  const secret = process.env.CALENDAR_STATE_SECRET;
  if (!secret) throw new Error("CALENDAR_STATE_SECRET is not set");
  return secret;
}

const mac = (body: string) => createHmac("sha256", stateKey()).update(`calendar-oauth-state:v1:${body}`).digest("base64url");

export function signState(state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** The state, or null when it's malformed, tampered, signed with another key or expired. */
export function verifyState(token: string, now = Date.now()): OAuthState | null {
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length > 0 || !process.env.CALENDAR_STATE_SECRET) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (typeof state.exp !== "number" || state.exp <= now) return null;
    if (![state.userId, state.companyId, state.nonce, state.returnTo].every((v) => typeof v === "string")) return null;
    return state;
  } catch {
    return null;
  }
}

/** An in-app path (IV-SEC-007), or My calendar. Never another origin. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return MY_CALENDAR_PATH;
  try {
    const base = "http://gethired.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return MY_CALENDAR_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return MY_CALENDAR_PATH;
  }
}

/** Why a connect attempt failed, or null when it can be saved. */
export function connectErrorReason(input: {
  googleError?: string | null;
  scopes?: string[];
  refreshToken?: string | null;
}): CalendarConnectError | null {
  if (input.googleError) {
    if (input.googleError === "access_denied") return "denied";
    if (input.googleError === "admin_policy_enforced" || input.googleError === "org_internal") return "admin_blocked";
    return "error";
  }
  const scopes = new Set(input.scopes ?? []);
  if (!scopes.has(SCOPE_EVENTS) || !scopes.has(SCOPE_FREEBUSY)) return "scopes";
  if (!input.refreshToken) return "no_refresh";
  return null;
}

/**
 * Stores the member's connection and both tokens, encrypted and bound to the
 * connection (service role). A reconnect keeps the connection's id and
 * replaces the tokens; the old refresh token isn't revoked (see the tasks
 * file's differences: revoking it would end the new grant too).
 */
export async function saveConnection(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    companyId: string;
    accountEmail: string;
    scopes: string[];
    refreshToken: string;
    accessToken: string;
    expiresIn: number;
  },
): Promise<{ connectionId: string }> {
  const now = new Date();
  const { data: connection, error } = await admin
    .from("calendar_connections")
    .upsert(
      {
        user_id: input.userId,
        company_id: input.companyId,
        provider: "google",
        account_email: input.accountEmail,
        scopes: input.scopes,
        status: "active",
        last_error: null,
        reconnect_emailed_at: null,
        connected_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();
  if (error || !connection) {
    reportError("[calendar] couldn't save the connection", error?.code ?? "no_row");
    throw new Error("Couldn't save the calendar connection");
  }

  const binding = { connectionId: connection.id, userId: input.userId };
  const refresh = encryptToken(input.refreshToken, { ...binding, kind: "refresh" });
  const access = encryptToken(input.accessToken, { ...binding, kind: "access" });
  const { error: tokenError } = await admin.from("calendar_tokens").upsert(
    {
      connection_id: connection.id,
      refresh_token_enc: refresh.value,
      access_token_enc: access.value,
      access_token_expires_at: new Date(now.getTime() + input.expiresIn * 1000).toISOString(),
      key_version: refresh.keyVersion,
      refreshed_at: now.toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (tokenError) {
    reportError("[calendar] couldn't save the tokens", tokenError.code);
    throw new Error("Couldn't save the calendar connection");
  }
  return { connectionId: connection.id };
}
