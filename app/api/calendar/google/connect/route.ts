import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  calendarEnabled,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  safeReturnTo,
  signState,
  STATE_TTL_MS,
} from "@/helpers/calendar/connect";
import { googleAuthUrl, pkcePair } from "@/helpers/calendar/google-oauth";
import { requireCompany } from "@/helpers/companies/require-company";

/**
 * GET (IVT-035, spec §4 "Connect flow"): sends the member to Google to
 * connect their own calendar. Any member may: it's their calendar. The state
 * is HMAC-signed; its nonce and the PKCE verifier sit in a short-lived
 * httpOnly cookie that only the callback reads.
 */
export async function GET(request: NextRequest) {
  if (!calendarEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;

  const nonce = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const state = signState({
    userId: auth.user.id,
    companyId: auth.company.id,
    nonce,
    returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
    exp: Date.now() + STATE_TTL_MS,
  });

  const res = NextResponse.redirect(googleAuthUrl({ state, codeChallenge: challenge }), {
    status: 303,
    headers: { "Cache-Control": "no-store" },
  });
  res.cookies.set(OAUTH_COOKIE, `${nonce}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000,
  });
  return res;
}
