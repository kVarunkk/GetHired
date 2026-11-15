import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { reportError } from "@/helpers/posthog/report-error";
import { refreshAccessToken } from "./google-oauth";
import { sendCalendarReconnectEmail } from "./reconnect-email";
import { CalendarError } from "./provider";
import { decryptToken, encryptToken } from "./token-crypto";
import { getAccessToken, withCalendarAuth } from "./tokens";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("./google-oauth", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("./reconnect-email", () => ({ sendCalendarReconnectEmail: vi.fn() }));

const CONNECTION = "ca000000-0000-4000-8000-000000000001";
const USER = "c2000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-16T10:00:00.000Z");
const REFRESH = "1//refresh-secret";

const seal = (value: string, kind: "refresh" | "access") =>
  encryptToken(value, { connectionId: CONNECTION, userId: USER, kind }).value;

let mock: SupabaseMock;

function queueConnection(tokens: { access?: string | null; expiresAt?: string | null } | null, status = "active") {
  mock.queue("calendar_connections", { data: { id: CONNECTION, user_id: USER, status }, error: null });
  mock.queue("calendar_tokens", {
    data: tokens && {
      refresh_token_enc: seal(REFRESH, "refresh"),
      access_token_enc: tokens.access ? seal(tokens.access, "access") : null,
      access_token_expires_at: tokens.expiresAt ?? null,
      key_version: 1,
    },
    error: null,
  });
}

const updatesOf = (table: string) =>
  mock.callsFor(table).filter((c) => c.chain.some((s) => s.method === "update" || s.method === "delete"));

beforeEach(() => {
  vi.stubEnv("CALENDAR_TOKEN_KEYS", JSON.stringify({ "1": randomBytes(32).toString("base64") }));
  vi.stubEnv("CALENDAR_TOKEN_KEY_CURRENT", "1");
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mock = createSupabaseMock();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getAccessToken (IVT-034, §4 Refreshing)", () => {
  it("uses the cached access token while it has more than 5 minutes left", async () => {
    queueConnection({ access: "ya29.cached", expiresAt: "2026-11-16T10:06:00.000Z" });
    expect(await getAccessToken(mock.client, CONNECTION)).toBe("ya29.cached");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(updatesOf("calendar_tokens")).toEqual([]);
  });

  it("refreshes a token with 5 minutes or less left, and stores the new one encrypted", async () => {
    queueConnection({ access: "ya29.old", expiresAt: "2026-11-16T10:04:00.000Z" });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "ya29.new", expiresIn: 3599 });

    expect(await getAccessToken(mock.client, CONNECTION)).toBe("ya29.new");
    expect(refreshAccessToken).toHaveBeenCalledWith(REFRESH);

    const [write] = updatesOf("calendar_tokens");
    const update = write.chain.find((s) => s.method === "update")!.args[0] as Record<string, unknown>;
    expect(write.chain).toContainEqual({ method: "eq", args: ["connection_id", CONNECTION] });
    expect(update.access_token_expires_at).toBe("2026-11-16T10:59:59.000Z");
    expect(update.refreshed_at).toBe(NOW.toISOString());
    expect(update.key_version).toBe(1);
    expect(update.access_token_enc).not.toContain("ya29.new");
    expect(decryptToken(update.access_token_enc as string, { connectionId: CONNECTION, userId: USER, kind: "access" })).toBe(
      "ya29.new",
    );
  });

  it("refreshes when nothing is cached, or when forced", async () => {
    queueConnection({ access: null });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "ya29.a", expiresIn: 3600 });
    expect(await getAccessToken(mock.client, CONNECTION)).toBe("ya29.a");

    queueConnection({ access: "ya29.cached", expiresAt: "2026-11-16T11:00:00.000Z" });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "ya29.b", expiresIn: 3600 });
    expect(await getAccessToken(mock.client, CONNECTION, { force: true })).toBe("ya29.b");
  });

  it("refuses a connection that's in error or has no tokens", async () => {
    mock.queue("calendar_connections", { data: { id: CONNECTION, user_id: USER, status: "error" }, error: null });
    await expect(getAccessToken(mock.client, CONNECTION)).rejects.toMatchObject({ code: "invalid_grant" });
    expect(mock.callsFor("calendar_tokens")).toEqual([]);

    queueConnection(null);
    await expect(getAccessToken(mock.client, CONNECTION)).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("on invalid_grant marks the connection broken, deletes the tokens and emails the member once", async () => {
    queueConnection({ access: null });
    vi.mocked(refreshAccessToken).mockRejectedValue(new CalendarError("invalid_grant", 400, "invalid_grant"));
    // The guarded claim returns the row the first time only.
    mock.queue("calendar_connections", { data: null, error: null });
    mock.queue("calendar_connections", { data: { id: CONNECTION }, error: null });

    await expect(getAccessToken(mock.client, CONNECTION)).rejects.toMatchObject({ code: "invalid_grant" });

    const [statusWrite, claim] = updatesOf("calendar_connections");
    expect(statusWrite.chain.find((s) => s.method === "update")!.args[0]).toMatchObject({
      status: "error",
      last_error: "invalid_grant",
    });
    expect(claim.chain).toContainEqual({ method: "is", args: ["reconnect_emailed_at", null] });
    expect(updatesOf("calendar_tokens")[0].chain).toContainEqual({ method: "delete", args: [] });
    expect(sendCalendarReconnectEmail).toHaveBeenCalledWith(USER);

    // A second failure finds the email already sent.
    queueConnection({ access: null });
    mock.queue("calendar_connections", { data: null, error: null });
    mock.queue("calendar_connections", { data: null, error: null });
    await expect(getAccessToken(mock.client, CONNECTION)).rejects.toMatchObject({ code: "invalid_grant" });
    expect(sendCalendarReconnectEmail).toHaveBeenCalledTimes(1);
  });

  it("reports the error code only, never a token or a body", async () => {
    queueConnection({ access: null });
    vi.mocked(refreshAccessToken).mockRejectedValue(new CalendarError("invalid_grant", 400, "invalid_grant"));
    await getAccessToken(mock.client, CONNECTION).catch(() => {});
    const reported = JSON.stringify(vi.mocked(reportError).mock.calls);
    expect(reported).toContain("invalid_grant");
    expect(reported).not.toContain(REFRESH);
    expect(reported).not.toMatch(/v1:/);
  });
});

describe("withCalendarAuth (IVT-034, §4 Refreshing)", () => {
  it("retries once with a forced refresh after a 401", async () => {
    queueConnection({ access: "ya29.revoked", expiresAt: "2026-11-16T11:00:00.000Z" });
    queueConnection({ access: "ya29.revoked", expiresAt: "2026-11-16T11:00:00.000Z" });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "ya29.fresh", expiresIn: 3600 });
    const fn = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new CalendarError("unauthorized", 401))
      .mockResolvedValueOnce("done");

    expect(await withCalendarAuth(mock.client, CONNECTION, fn)).toBe("done");
    expect(fn.mock.calls).toEqual([["ya29.revoked"], ["ya29.fresh"]]);
  });

  it("doesn't retry other errors, or a second 401", async () => {
    queueConnection({ access: "a", expiresAt: "2026-11-16T11:00:00.000Z" });
    const notFound = vi.fn().mockRejectedValue(new CalendarError("not_found", 404));
    await expect(withCalendarAuth(mock.client, CONNECTION, notFound)).rejects.toMatchObject({ code: "not_found" });
    expect(notFound).toHaveBeenCalledTimes(1);

    queueConnection({ access: "a", expiresAt: "2026-11-16T11:00:00.000Z" });
    queueConnection({ access: "a", expiresAt: "2026-11-16T11:00:00.000Z" });
    vi.mocked(refreshAccessToken).mockResolvedValue({ accessToken: "b", expiresIn: 3600 });
    const always401 = vi.fn().mockRejectedValue(new CalendarError("unauthorized", 401));
    await expect(withCalendarAuth(mock.client, CONNECTION, always401)).rejects.toMatchObject({ code: "unauthorized" });
    expect(always401).toHaveBeenCalledTimes(2);
  });
});
