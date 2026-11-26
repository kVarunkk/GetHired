/**
 * The middleware's session read, run through the real `@supabase/ssr` client
 * with the Auth server faked at `fetch`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { getMiddlewareAuth } from "./get-middleware-auth";

const SUPABASE_URL = "https://project.supabase.test";
const COOKIE = "sb-project-auth-token";

let privateKey: CryptoKey;
let publicJwk: JWK;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const calls: string[] = [];
let authUser: Record<string, unknown> | null;
let refreshed: unknown;

const fakeFetch = async (input: RequestInfo | URL) => {
  const { pathname } = new URL(String(input instanceof Request ? input.url : input));
  calls.push(pathname);
  if (pathname.endsWith("/jwks.json")) return json({ keys: [publicJwk] });
  if (pathname.endsWith("/user")) {
    return authUser ? json(authUser) : json({ code: "session_not_found", msg: "gone" }, 403);
  }
  if (pathname.endsWith("/token")) return json(refreshed);
  throw new Error(`Unexpected request: ${pathname}`);
};

const now = () => Math.floor(Date.now() / 1000);

function sign(appMetadata: Record<string, unknown>, expiresAt = now() + 3600) {
  return new SignJWT({ sub: "user-1", role: "authenticated", app_metadata: appMetadata })
    .setProtectedHeader({ alg: "ES256", kid: "key-1", typ: "JWT" })
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

const session = (accessToken: string, expiresAt = now() + 3600) => ({
  access_token: accessToken,
  refresh_token: "refresh-1",
  token_type: "bearer",
  expires_in: expiresAt - now(),
  expires_at: expiresAt,
  user: { id: "user-1" },
});

function request(init: { session?: unknown; bearer?: string } = {}) {
  const headers = new Headers();
  if (init.session) {
    const value = "base64-" + Buffer.from(JSON.stringify(init.session)).toString("base64url");
    headers.set("cookie", `${COOKIE}=${value}`);
  }
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  return new NextRequest("http://localhost:3000/dashboard", { headers });
}

const authServerCalls = () => calls.filter((path) => !path.endsWith("/jwks.json"));

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
});

beforeEach(() => {
  calls.length = 0;
  authUser = null;
  refreshed = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getMiddlewareAuth", () => {
  it("reads a signed-out visitor without calling Supabase", async () => {
    const { user } = await getMiddlewareAuth(request(), null);

    expect(user).toBeNull();
    expect(calls).toEqual([]);
  });

  it.each([
    ["an applicant", { type: "applicant" }],
    ["an onboarded company", { type: "company", onboarding_complete: true }],
  ])("reads %s from the verified token, without asking the Auth server", async (_name, metadata) => {
    const { user } = await getMiddlewareAuth(request({ session: session(await sign(metadata)) }), null);

    expect(user?.app_metadata).toEqual(metadata);
    expect(authServerCalls()).toEqual([]);
  });

  it.each([
    ["a company still onboarding", { type: "company", onboarding_complete: false }],
    ["a user with no role yet", {}],
  ])("asks the Auth server about %s, whose token may be out of date", async (_name, metadata) => {
    authUser = { id: "user-1", app_metadata: { type: "company", onboarding_complete: true } };

    const { user } = await getMiddlewareAuth(request({ session: session(await sign(metadata)) }), null);

    expect(user?.app_metadata).toEqual({ type: "company", onboarding_complete: true });
    expect(authServerCalls()).toEqual(["/auth/v1/user"]);
  });

  it("doesn't trust a token whose signature doesn't match", async () => {
    const token = await sign({ type: "applicant" });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "user-1", exp: now() + 3600, app_metadata: { type: "company", onboarding_complete: true } }),
    ).toString("base64url");

    const { user } = await getMiddlewareAuth(
      request({ session: session(`${header}.${forged}.${signature}`) }),
      null,
    );

    expect(user).toBeNull();
  });

  it("verifies a bearer token, with no cookies", async () => {
    const bearer = await sign({ type: "applicant" });

    const { user } = await getMiddlewareAuth(request({ bearer }), bearer);

    expect(user?.app_metadata).toEqual({ type: "applicant" });
    expect(authServerCalls()).toEqual([]);
  });

  it("treats a bearer token that isn't a JWT as signed out", async () => {
    const { user } = await getMiddlewareAuth(request({ bearer: "not-a-token" }), "not-a-token");

    expect(user).toBeNull();
  });

  it("puts a refreshed session on the request and on any response", async () => {
    const expired = session(await sign({ type: "applicant" }, now() - 60), now() - 60);
    refreshed = { ...session(await sign({ type: "applicant" })), refresh_token: "refresh-2" };
    const incoming = request({ session: expired });
    const before = incoming.cookies.get(COOKIE)?.value;

    const { user, withSessionCookies } = await getMiddlewareAuth(incoming, null);
    const response = withSessionCookies(NextResponse.redirect("http://localhost:3000/auth/login"));

    expect(user?.app_metadata).toEqual({ type: "applicant" });
    const sent = response.cookies.get(COOKIE)?.value;
    expect(sent).toBeTruthy();
    expect(sent).not.toBe(before);
    expect(incoming.cookies.get(COOKIE)?.value).toBe(sent);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("leaves a response alone when the session didn't change", async () => {
    const { withSessionCookies } = await getMiddlewareAuth(
      request({ session: session(await sign({ type: "applicant" })) }),
      null,
    );
    const response = withSessionCookies(NextResponse.next());

    expect(response.cookies.getAll()).toEqual([]);
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
