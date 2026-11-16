import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { OAUTH_COOKIE, verifyState } from "@/helpers/calendar/connect";
import { SCOPE_EVENTS, SCOPE_FREEBUSY } from "@/helpers/calendar/google-oauth";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

async function signIn(member: MemberFixture | null) {
  const rls = createSupabaseMock({ user: member?.user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member?.user ?? null, rls.client);
}

const call = (returnTo?: string) =>
  GET(buildRequest("/api/calendar/google/connect", { searchParams: returnTo ? { returnTo } : {} }));

beforeEach(async () => {
  vi.stubEnv("CALENDAR_ENABLED", "true");
  vi.stubEnv("CALENDAR_STATE_SECRET", "state-secret-for-tests-0123456789");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "client-secret");
  await signIn(MEMBER_A);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/calendar/google/connect (IVT-035)", () => {
  it("redirects a member to Google with offline access, consent, PKCE and a signed state", async () => {
    const res = await call("/company/applications/a1/interviews");
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("client-id.apps.googleusercontent.com");
    expect(q.get("redirect_uri")).toMatch(/\/api\/calendar\/google\/callback$/);
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("include_granted_scopes")).toBe("true");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("scope")!.split(" ").sort()).toEqual(["email", "openid", SCOPE_EVENTS, SCOPE_FREEBUSY].sort());
    expect(q.get("scope")).not.toMatch(/auth\/calendar(\s|$|\.readonly)/);

    const state = verifyState(q.get("state")!);
    expect(state).toMatchObject({
      userId: MEMBER_A.user.id,
      companyId: COMPANY_A.id,
      returnTo: "/company/applications/a1/interviews",
    });

    const cookie = res.cookies.get(OAUTH_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/api/calendar/google");
    expect(cookie.sameSite).toBe("lax");
    const [nonce, verifier] = cookie.value.split(".");
    expect(nonce).toBe(state!.nonce);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("works for a member with no permissions: the calendar is their own", async () => {
    await signIn(memberWith([]));
    expect((await call()).status).toBe(303);
  });

  it("drops an off-site returnTo", async () => {
    const res = await call("https://evil.test/");
    const state = verifyState(new URL(res.headers.get("location")!).searchParams.get("state")!);
    expect(state?.returnTo).toBe("/company/settings/my-calendar");
  });

  it("refuses signed-out callers and applicants", async () => {
    await signIn(null);
    expect((await call()).status).toBe(401);
  });

  it("is a 404 while CALENDAR_ENABLED is off", async () => {
    vi.stubEnv("CALENDAR_ENABLED", "false");
    expect((await call()).status).toBe(404);
  });
});
