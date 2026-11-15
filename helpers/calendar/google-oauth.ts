import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { deploymentUrl } from "@/utils/formatters";
import { calendarErrorOf } from "./google";
import { CalendarError } from "./provider";

// Google's OAuth endpoints for the calendar connection (spec §4 "Connect
// flow", "Refreshing"). Separate from Supabase's Google sign-in.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const SCOPE_EVENTS = "https://www.googleapis.com/auth/calendar.events";
export const SCOPE_FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";
/** `openid email` for the account email; never `calendar` or `calendar.readonly`. */
export const CALENDAR_SCOPES = ["openid", "email", SCOPE_EVENTS, SCOPE_FREEBUSY] as const;

export const CALLBACK_PATH = "/api/calendar/google/callback";

export const calendarRedirectUri = () => `${deploymentUrl()}${CALLBACK_PATH}`;

function client() {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET are not set");
  return { id, secret };
}

/** A PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function googleAuthUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client().id,
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const { id, secret } = client();
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: id, client_secret: secret }).toString(),
      cache: "no-store",
    });
  } catch {
    throw new CalendarError("error", null, "network");
  }
  if (!res.ok) throw await calendarErrorOf(res);
  return (await res.json()) as Record<string, unknown>;
}

export type CodeExchange = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
  idToken: string | null;
};

export async function exchangeCode({ code, codeVerifier }: { code: string; codeVerifier: string }): Promise<CodeExchange> {
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: calendarRedirectUri(),
  });
  if (typeof body.access_token !== "string") throw new CalendarError("error", null, "no_access_token");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
    idToken: typeof body.id_token === "string" ? body.id_token : null,
  };
}

/** A new access token. Throws CalendarError `invalid_grant` when the refresh token is dead. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const body = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (typeof body.access_token !== "string") throw new CalendarError("error", null, "no_access_token");
  return { accessToken: body.access_token, expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600 };
}

/**
 * The account email from the id token Google returned with the code exchange.
 * The token came straight from Google's token endpoint over TLS, so its
 * signature isn't checked again (OpenID Connect Core §3.1.3.7).
 */
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: unknown;
      email_verified?: unknown;
    };
    if (typeof payload.email !== "string" || payload.email_verified === false) return null;
    return payload.email.toLowerCase();
  } catch {
    return null;
  }
}
