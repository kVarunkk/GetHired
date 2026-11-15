import { NextRequest, NextResponse } from "next/server";
import {
  calendarEnabled,
  connectErrorReason,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  safeReturnTo,
  saveConnection,
  verifyState,
} from "@/helpers/calendar/connect";
import type { CalendarConnectError } from "@/helpers/calendar/copy";
import { googleCalendar } from "@/helpers/calendar/google";
import { emailFromIdToken, exchangeCode } from "@/helpers/calendar/google-oauth";
import { MY_CALENDAR_PATH } from "@/helpers/calendar/config";
import { requireCompany } from "@/helpers/companies/require-company";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

function back(request: NextRequest, returnTo: string, outcome: { error: CalendarConnectError } | "connected") {
  const url = new URL(returnTo, request.nextUrl.origin);
  if (outcome === "connected") url.searchParams.set("calendar", "connected");
  else url.searchParams.set("calendar_error", outcome.error);
  const res = NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax" });
  return res;
}

/**
 * GET (IVT-035, spec §4 "Connect flow"): Google's redirect back. Checks the
 * state's signature and expiry, the cookie's nonce, and that the signed-in
 * member is the one who started. Saves the connection only with a refresh
 * token and both calendar scopes. Every outcome returns to the in-app
 * `returnTo` with `calendar=connected` or `calendar_error=<reason>`. Still
 * behind a session: the middleware keeps it private.
 */
export async function GET(request: NextRequest) {
  if (!calendarEnabled()) return back(request, MY_CALENDAR_PATH, { error: "disabled" });

  const params = request.nextUrl.searchParams;
  const state = verifyState(params.get("state") ?? "");
  const returnTo = safeReturnTo(state?.returnTo);
  if (!state) return back(request, returnTo, { error: "expired" });

  const [nonce, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  if (!nonce || !verifier || nonce !== state.nonce) return back(request, returnTo, { error: "expired" });

  const auth = await requireCompany();
  if (!auth.ok || auth.user.id !== state.userId || auth.company.id !== state.companyId) {
    return back(request, returnTo, { error: "mismatch" });
  }

  const googleError = params.get("error");
  if (googleError) return back(request, returnTo, { error: connectErrorReason({ googleError }) ?? "error" });
  const code = params.get("code");
  if (!code) return back(request, returnTo, { error: "error" });

  let exchange: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    exchange = await exchangeCode({ code, codeVerifier: verifier });
  } catch (err) {
    reportError("[calendar] code exchange failed", err instanceof Error ? err.message : "error");
    return back(request, returnTo, { error: "error" });
  }

  const refusal = connectErrorReason({ scopes: exchange.scopes, refreshToken: exchange.refreshToken });
  const accountEmail = emailFromIdToken(exchange.idToken);
  if (refusal || !accountEmail) {
    // Nothing is stored, so don't leave Google holding a grant we won't use.
    try {
      await googleCalendar.revoke(exchange.refreshToken ?? exchange.accessToken);
    } catch {
      // Best effort: the member can remove access in their Google Account.
    }
    return back(request, returnTo, { error: refusal ?? "error" });
  }

  try {
    await saveConnection(createServiceRoleClient(), {
      userId: auth.user.id,
      companyId: auth.company.id,
      accountEmail,
      scopes: exchange.scopes,
      refreshToken: exchange.refreshToken!,
      accessToken: exchange.accessToken,
      expiresIn: exchange.expiresIn,
    });
  } catch {
    return back(request, returnTo, { error: "error" });
  }
  return back(request, returnTo, "connected");
}
