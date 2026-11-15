import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { reportError } from "@/helpers/posthog/report-error";
import { googleCalendar } from "./google";
import { CalendarError } from "./provider";
import { encryptToken } from "./token-crypto";
import { disconnectCalendar, MAX_REVOKE_ATTEMPTS, revokePendingCalendars } from "./disconnect";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("./google", () => ({ googleCalendar: { revoke: vi.fn() } }));

const USER = "c2000000-0000-4000-8000-000000000001";
const CONNECTION = "ca000000-0000-4000-8000-000000000001";

let admin: SupabaseMock;

const sealed = (connectionId: string, userId: string, value: string) =>
  encryptToken(value, { connectionId, userId, kind: "refresh" }).value;

const ops = (table: string) =>
  admin.callsFor(table).map((c) => c.chain.map((s) => s.method).filter((m) => ["delete", "update"].includes(m))[0]).filter(Boolean);

beforeEach(() => {
  vi.stubEnv("CALENDAR_TOKEN_KEYS", JSON.stringify({ "1": randomBytes(32).toString("base64") }));
  vi.stubEnv("CALENDAR_TOKEN_KEY_CURRENT", "1");
  admin = createSupabaseMock();
  vi.mocked(googleCalendar.revoke).mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("disconnectCalendar (IVT-036, IV-REQ-010)", () => {
  beforeEach(() => {
    admin.queue("calendar_connections", { data: [{ id: CONNECTION, user_id: USER }], error: null });
    admin.queue("calendar_tokens", { data: [{ connection_id: CONNECTION, refresh_token_enc: sealed(CONNECTION, USER, "1//r") }], error: null });
  });

  it("revokes at Google, then deletes the tokens before the connection", async () => {
    expect(await disconnectCalendar(admin.client, USER)).toEqual({ ok: true, revoked: true });
    expect(googleCalendar.revoke).toHaveBeenCalledWith("1//r");
    const order = admin.calls.filter((c) => c.chain.some((s) => s.method === "delete")).map((c) => c.target);
    expect(order).toEqual(["calendar_tokens", "calendar_connections"]);
    expect(admin.callsFor("calendar_connections").at(-1)!.chain).toContainEqual({ method: "eq", args: ["user_id", USER] });
  });

  it("still deletes both rows when the revoke fails, and reports it", async () => {
    vi.mocked(googleCalendar.revoke).mockRejectedValue(new CalendarError("error", 503));
    expect(await disconnectCalendar(admin.client, USER)).toEqual({ ok: true, revoked: false });
    expect(ops("calendar_tokens")).toContain("delete");
    expect(ops("calendar_connections")).toContain("delete");
    expect(reportError).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(reportError).mock.calls)).not.toContain("1//r");
  });

  it("deletes the rows when the token can't be decrypted", async () => {
    admin.reset();
    admin.queue("calendar_connections", { data: [{ id: CONNECTION, user_id: USER }], error: null });
    admin.queue("calendar_tokens", { data: [{ connection_id: CONNECTION, refresh_token_enc: "v1:bad:bad" }], error: null });
    expect(await disconnectCalendar(admin.client, USER)).toEqual({ ok: true, revoked: false });
    expect(ops("calendar_connections")).toContain("delete");
  });
});

describe("disconnectCalendar without a connection", () => {
  it("is a no-op", async () => {
    admin.queue("calendar_connections", { data: [], error: null });
    expect(await disconnectCalendar(admin.client, USER)).toEqual({ ok: true, revoked: false });
    expect(googleCalendar.revoke).not.toHaveBeenCalled();
  });
});

describe("revokePendingCalendars (§4 Removal: leaving, removal, account deletion)", () => {
  const pending = (n: number, attempts = 0) => ({
    connection_id: `ca000000-0000-4000-8000-00000000000${n}`,
    user_id: USER,
    provider: "google",
    refresh_token_enc: sealed(`ca000000-0000-4000-8000-00000000000${n}`, USER, `1//left-${n}`),
    attempts,
  });

  it("revokes each token with its old binding and deletes the row", async () => {
    admin.queue("calendar_pending_revocations", { data: [pending(1), pending(2)], error: null });
    expect(await revokePendingCalendars(admin.client)).toEqual({ revoked: 2, failed: 0, gaveUp: 0 });
    expect(vi.mocked(googleCalendar.revoke).mock.calls).toEqual([["1//left-1"], ["1//left-2"]]);
    expect(ops("calendar_pending_revocations").filter((m) => m === "delete")).toHaveLength(2);
  });

  it("counts a failure and keeps the row, then gives up after the last attempt", async () => {
    vi.mocked(googleCalendar.revoke).mockRejectedValue(new CalendarError("error", 503));
    admin.queue("calendar_pending_revocations", {
      data: [pending(1), pending(2, MAX_REVOKE_ATTEMPTS - 1)],
      error: null,
    });
    expect(await revokePendingCalendars(admin.client)).toEqual({ revoked: 0, failed: 1, gaveUp: 1 });
    const writes = admin.callsFor("calendar_pending_revocations").slice(1);
    expect(writes[0].chain).toContainEqual({ method: "update", args: [{ attempts: 1 }] });
    expect(writes[1].chain.map((s) => s.method)).toContain("delete");
  });

  it("drops a row it can't decrypt", async () => {
    admin.queue("calendar_pending_revocations", { data: [{ ...pending(1), refresh_token_enc: "v1:x:y" }], error: null });
    expect(await revokePendingCalendars(admin.client)).toEqual({ revoked: 0, failed: 0, gaveUp: 1 });
    expect(googleCalendar.revoke).not.toHaveBeenCalled();
  });
});
