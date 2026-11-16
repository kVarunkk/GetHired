import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { reportError } from "@/helpers/posthog/report-error";
import {
  calendarEnabled,
  connectErrorReason,
  safeReturnTo,
  saveConnection,
  signState,
  verifyState,
  type OAuthState,
} from "./connect";
import { SCOPE_EVENTS, SCOPE_FREEBUSY } from "./google-oauth";
import { decryptToken } from "./token-crypto";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const USER = "c2000000-0000-4000-8000-000000000001";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-16T10:00:00.000Z");

const state = (overrides: Partial<OAuthState> = {}): OAuthState => ({
  userId: USER,
  companyId: COMPANY,
  nonce: "n0nce",
  returnTo: "/company/settings/my-calendar",
  exp: NOW + 600_000,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("CALENDAR_STATE_SECRET", "state-secret-for-tests-0123456789");
  vi.stubEnv("CALENDAR_TOKEN_KEYS", JSON.stringify({ "1": randomBytes(32).toString("base64") }));
  vi.stubEnv("CALENDAR_TOKEN_KEY_CURRENT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("OAuth state (IVT-035, §4 Connect flow)", () => {
  it("round-trips a signed state", () => {
    expect(verifyState(signState(state()), NOW)).toEqual(state());
  });

  it("refuses a tampered, expired or foreign-signed state", () => {
    const token = signState(state());
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state(), userId: "someone-else" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyState(`${body}.${sig}x`, NOW)).toBeNull();
    expect(verifyState(signState(state({ exp: NOW - 1 })), NOW)).toBeNull();
    expect(verifyState("garbage", NOW)).toBeNull();

    vi.stubEnv("CALENDAR_STATE_SECRET", "another-secret-entirely-0123456789");
    expect(verifyState(token, NOW)).toBeNull();
  });

  it("refuses to sign without a secret", () => {
    vi.stubEnv("CALENDAR_STATE_SECRET", "");
    expect(() => signState(state())).toThrow(/CALENDAR_STATE_SECRET/);
  });
});

describe("safeReturnTo (IV-SEC-007, no open redirect)", () => {
  it.each([
    ["/company/applications/a1/interviews", "/company/applications/a1/interviews"],
    ["/company/settings/my-calendar?x=1", "/company/settings/my-calendar?x=1"],
  ])("keeps the in-app path %s", (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it.each([
    "https://evil.test/",
    "//evil.test/path",
    "/\\evil.test",
    "javascript:alert(1)",
    "company/settings",
    "",
    null,
  ])("falls back to My calendar for %s", (raw) => {
    expect(safeReturnTo(raw)).toBe("/company/settings/my-calendar");
  });
});

describe("connectErrorReason", () => {
  it("maps Google's errors and our refusals", () => {
    expect(connectErrorReason({ googleError: "access_denied" })).toBe("denied");
    expect(connectErrorReason({ googleError: "admin_policy_enforced" })).toBe("admin_blocked");
    expect(connectErrorReason({ googleError: "org_internal" })).toBe("admin_blocked");
    expect(connectErrorReason({ googleError: "server_error" })).toBe("error");
    expect(connectErrorReason({ scopes: ["openid", "email", SCOPE_EVENTS], refreshToken: "r" })).toBe("scopes");
    expect(connectErrorReason({ scopes: [SCOPE_EVENTS, SCOPE_FREEBUSY], refreshToken: null })).toBe("no_refresh");
    expect(connectErrorReason({ scopes: [SCOPE_EVENTS, SCOPE_FREEBUSY], refreshToken: "r" })).toBeNull();
  });
});

describe("saveConnection (IVT-035)", () => {
  let admin: SupabaseMock;
  const input = {
    userId: USER,
    companyId: COMPANY,
    accountEmail: "rita@gmail.test",
    scopes: ["openid", "email", SCOPE_EVENTS, SCOPE_FREEBUSY],
    refreshToken: "1//new-refresh",
    accessToken: "ya29.new",
    expiresIn: 3600,
  };

  beforeEach(() => {
    admin = createSupabaseMock();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const writes = (table: string) =>
    admin.callsFor(table).flatMap((c) => c.chain.filter((s) => ["insert", "update", "upsert"].includes(s.method)));

  it("upserts the connection and stores both tokens encrypted and bound to it", async () => {
    admin.queue("calendar_connections", { data: { id: "conn-1" }, error: null });

    expect(await saveConnection(admin.client, input)).toEqual({ connectionId: "conn-1" });

    const [connection] = writes("calendar_connections");
    expect(connection.method).toBe("upsert");
    expect(connection.args[0]).toMatchObject({
      user_id: USER,
      company_id: COMPANY,
      provider: "google",
      account_email: "rita@gmail.test",
      scopes: input.scopes,
      status: "active",
      last_error: null,
      reconnect_emailed_at: null,
    });
    expect(connection.args[1]).toEqual({ onConflict: "user_id,provider" });

    const [tokens] = writes("calendar_tokens");
    expect(tokens.method).toBe("upsert");
    const row = tokens.args[0] as Record<string, string>;
    expect(row.connection_id).toBe("conn-1");
    expect(JSON.stringify(row)).not.toContain("new-refresh");
    expect(JSON.stringify(row)).not.toContain("ya29.new");
    const binding = { connectionId: "conn-1", userId: USER };
    expect(decryptToken(row.refresh_token_enc, { ...binding, kind: "refresh" })).toBe("1//new-refresh");
    expect(decryptToken(row.access_token_enc, { ...binding, kind: "access" })).toBe("ya29.new");
    expect(row.access_token_expires_at).toBe("2026-11-16T11:00:00.000Z");
  });

  it("reports a failed write by code only", async () => {
    admin.queue("calendar_connections", { data: null, error: { code: "23505", message: "dup with 1//new-refresh" } });
    await expect(saveConnection(admin.client, input)).rejects.toThrow();
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain("new-refresh");
  });
});

describe("calendarEnabled", () => {
  it("is off unless CALENDAR_ENABLED is true", () => {
    vi.stubEnv("CALENDAR_ENABLED", "");
    expect(calendarEnabled()).toBe(false);
    vi.stubEnv("CALENDAR_ENABLED", "true");
    expect(calendarEnabled()).toBe(true);
  });
});
