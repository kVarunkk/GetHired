import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, MEMBER_B, type MemberFixture } from "@/test/utils/team";
import { OAUTH_COOKIE, saveConnection, signState, type OAuthState } from "@/helpers/calendar/connect";
import { exchangeCode, SCOPE_EVENTS, SCOPE_FREEBUSY } from "@/helpers/calendar/google-oauth";
import { googleCalendar } from "@/helpers/calendar/google";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/calendar/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar/google-oauth")>()),
  exchangeCode: vi.fn(),
}));
vi.mock("@/helpers/calendar/google", () => ({ googleCalendar: { revoke: vi.fn() } }));
vi.mock("@/helpers/calendar/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar/connect")>()),
  saveConnection: vi.fn(),
}));

const idToken = (email: string) =>
  `h.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.s`;

const RETURN_TO = "/company/applications/a1/interviews";

let rls: SupabaseMock;

async function signIn(member: MemberFixture | null) {
  rls = createSupabaseMock({ user: member?.user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member?.user ?? null, rls.client);
}

const stateFor = (overrides: Partial<OAuthState> = {}): OAuthState => ({
  userId: MEMBER_A.user.id,
  companyId: COMPANY_A.id,
  nonce: "nonce123",
  returnTo: RETURN_TO,
  exp: Date.now() + 600_000,
  ...overrides,
});

function call({
  state = signState(stateFor()),
  cookie = "nonce123.verifier-abc",
  params = { code: "4/code" } as Record<string, string>,
} = {}) {
  const url = new URL("http://localhost:3000/api/calendar/google/callback");
  for (const [k, v] of Object.entries({ ...params, state })) url.searchParams.set(k, v);
  return GET(new NextRequest(url, { headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {} }));
}

const target = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return { path: url.pathname, connected: url.searchParams.get("calendar"), error: url.searchParams.get("calendar_error") };
};

beforeEach(async () => {
  vi.stubEnv("CALENDAR_ENABLED", "true");
  vi.stubEnv("CALENDAR_STATE_SECRET", "state-secret-for-tests-0123456789");
  await signIn(MEMBER_A);
  vi.mocked(exchangeCode).mockResolvedValue({
    accessToken: "ya29.a",
    refreshToken: "1//r",
    expiresIn: 3599,
    scopes: ["openid", "https://www.googleapis.com/auth/userinfo.email", SCOPE_EVENTS, SCOPE_FREEBUSY],
    idToken: idToken("Rita@Gmail.test"),
  });
  vi.mocked(saveConnection).mockResolvedValue({ connectionId: "conn-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/calendar/google/callback (IVT-035)", () => {
  it("exchanges the code with the cookie's PKCE verifier, saves the connection and returns", async () => {
    const res = await call();
    expect(res.status).toBe(303);
    expect(target(res)).toEqual({ path: RETURN_TO, connected: "connected", error: null });
    expect(exchangeCode).toHaveBeenCalledWith({ code: "4/code", codeVerifier: "verifier-abc" });
    expect(saveConnection).toHaveBeenCalledWith(
      { service: true },
      {
        userId: MEMBER_A.user.id,
        companyId: COMPANY_A.id,
        accountEmail: "rita@gmail.test",
        scopes: expect.arrayContaining([SCOPE_EVENTS, SCOPE_FREEBUSY]),
        refreshToken: "1//r",
        accessToken: "ya29.a",
        expiresIn: 3599,
      },
    );
    // The one-time cookie is cleared.
    expect(res.cookies.get(OAUTH_COOKIE)?.value).toBe("");
  });

  it.each([
    ["a tampered state", () => ({ state: `${signState(stateFor())}x` }), "expired"],
    ["an expired state", () => ({ state: signState(stateFor({ exp: Date.now() - 1 })) }), "expired"],
    ["no cookie", () => ({ cookie: "" }), "expired"],
    ["another nonce in the cookie", () => ({ cookie: "other.verifier-abc" }), "expired"],
  ])("refuses %s and stores nothing", async (_label, args, reason) => {
    const res = await call(args());
    expect(target(res).error).toBe(reason);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it("refuses when someone else is signed in, or the member changed company", async () => {
    await signIn(ADMIN_A);
    expect(target(await call()).error).toBe("mismatch");
    await signIn({ ...MEMBER_B, user: MEMBER_A.user });
    expect(target(await call()).error).toBe("mismatch");
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["access_denied", "denied"],
    ["admin_policy_enforced", "admin_blocked"],
  ])("shows Google's %s as %s", async (googleError, reason) => {
    const res = await call({ params: { error: googleError } });
    expect(target(res)).toMatchObject({ path: RETURN_TO, error: reason });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("refuses without both calendar scopes, stores nothing and revokes what Google gave", async () => {
    vi.mocked(exchangeCode).mockResolvedValue({
      accessToken: "ya29.a",
      refreshToken: "1//r",
      expiresIn: 3599,
      scopes: ["openid", SCOPE_FREEBUSY],
      idToken: idToken("rita@gmail.test"),
    });
    expect(target(await call()).error).toBe("scopes");
    expect(saveConnection).not.toHaveBeenCalled();
    expect(googleCalendar.revoke).toHaveBeenCalledWith("1//r");
  });

  it("refuses without a refresh token", async () => {
    vi.mocked(exchangeCode).mockResolvedValue({
      accessToken: "ya29.a",
      refreshToken: null,
      expiresIn: 3599,
      scopes: [SCOPE_EVENTS, SCOPE_FREEBUSY],
      idToken: idToken("rita@gmail.test"),
    });
    expect(target(await call()).error).toBe("no_refresh");
    expect(saveConnection).not.toHaveBeenCalled();
  });

  it("answers a failed exchange or save with the generic error", async () => {
    vi.mocked(exchangeCode).mockRejectedValueOnce(new Error("boom"));
    expect(target(await call()).error).toBe("error");
    await signIn(MEMBER_A);
    vi.mocked(saveConnection).mockRejectedValueOnce(new Error("boom"));
    expect(target(await call()).error).toBe("error");
  });

  it("goes back to My calendar while CALENDAR_ENABLED is off", async () => {
    vi.stubEnv("CALENDAR_ENABLED", "false");
    expect(target(await call())).toMatchObject({ path: "/company/settings/my-calendar", error: "disabled" });
  });
});
