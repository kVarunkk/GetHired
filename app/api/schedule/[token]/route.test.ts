import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { buildRequest } from "@/test/utils/request";
import { bookByToken, cancelByToken, rescheduleByToken } from "@/helpers/interviews/self-scheduling";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { LINK_IP_LIMIT, LINK_LIMIT_WINDOW_SECONDS, LINK_TOKEN_LIMIT } from "@/helpers/calendar/config";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/calendar/active-provider", () => ({ calendarProvider: vi.fn(() => ({ provider: true })) }));
vi.mock("@/helpers/interviews/self-scheduling", () => ({
  bookByToken: vi.fn(),
  rescheduleByToken: vi.fn(),
  cancelByToken: vi.fn(),
}));

const TOKEN = "t".repeat(43);
const START = "2026-11-17T10:00:00.000Z";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

let admin: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CALENDAR_ENABLED", "true");
  // The rate limit allows by default.
  admin = createSupabaseMock({
    fallback: (call) => (call.target === "take_scheduling_link_hit" ? { data: true, error: null } : { data: null, error: null }),
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
});

afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown, token = TOKEN, headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) =>
  POST(buildRequest(`/api/schedule/${token}`, { method: "POST", body, headers }), { params: Promise.resolve({ token }) });

describe("POST /api/schedule/[token] (IVT-063)", () => {
  it("books with the service role and the provider", async () => {
    vi.mocked(bookByToken).mockResolvedValue({ ok: true, startsAt: START });
    const res = await post({ action: "book", startsAt: START, timeZone: "Europe/Paris" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, startsAt: START });
    expect(bookByToken).toHaveBeenCalledWith({ admin: admin.client, provider: { provider: true } }, TOKEN, {
      startsAt: START,
      timeZone: "Europe/Paris",
    });
  });

  it("reschedules and cancels", async () => {
    vi.mocked(rescheduleByToken).mockResolvedValue({ ok: true, startsAt: START });
    vi.mocked(cancelByToken).mockResolvedValue({ ok: true, startsAt: null });
    expect((await post({ action: "reschedule", startsAt: START })).status).toBe(200);
    expect(vi.mocked(rescheduleByToken).mock.calls[0].slice(1)).toEqual([TOKEN, { startsAt: START }]);
    expect((await post({ action: "cancel" })).status).toBe(200);
    expect(vi.mocked(cancelByToken).mock.calls[0][1]).toBe(TOKEN);
  });

  it("answers a taken slot with 409 and the candidate's copy", async () => {
    vi.mocked(bookByToken).mockResolvedValue({ ok: false, reason: "slot_taken", error: "That time was just taken. Pick another one." });
    const res = await post({ action: "book", startsAt: START });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "slot_taken", error: "That time was just taken. Pick another one." });
  });

  it("answers an unknown link with 404", async () => {
    vi.mocked(cancelByToken).mockResolvedValue({ ok: false, reason: "not_found", error: "x" });
    expect((await post({ action: "cancel" })).status).toBe(404);
    expect((await post({ action: "cancel" }, "short")).status).toBe(404);
  });

  it("refuses a malformed body", async () => {
    expect((await post({ action: "book", startsAt: "tomorrow" })).status).toBe(400);
    expect((await post({ action: "delete" })).status).toBe(400);
    expect(bookByToken).not.toHaveBeenCalled();
  });

  it("rate-limits per token and per IP, by their hashes", async () => {
    vi.mocked(cancelByToken).mockResolvedValue({ ok: true, startsAt: null });
    await post({ action: "cancel" });
    const calls = admin.callsFor("take_scheduling_link_hit").map((c) => c.chain[0].args[1]);
    expect(calls).toEqual([
      { p_key: `token:${sha256(TOKEN)}`, p_limit: LINK_TOKEN_LIMIT, p_window_seconds: LINK_LIMIT_WINDOW_SECONDS },
      { p_key: `ip:${sha256("203.0.113.9")}`, p_limit: LINK_IP_LIMIT, p_window_seconds: LINK_LIMIT_WINDOW_SECONDS },
    ]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(JSON.stringify(calls)).not.toContain("203.0.113.9");
  });

  it("answers 429 over a limit, before doing anything", async () => {
    admin.queueRpc("take_scheduling_link_hit", { data: true, error: null });
    admin.queueRpc("take_scheduling_link_hit", { data: false, error: null });
    const res = await post({ action: "book", startsAt: START });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "rate_limited" });
    expect(bookByToken).not.toHaveBeenCalled();
  });

  it("is off while CALENDAR_ENABLED is", async () => {
    vi.stubEnv("CALENDAR_ENABLED", "");
    expect((await post({ action: "cancel" })).status).toBe(404);
    expect(admin.calls).toHaveLength(0);
  });

  it("hides errors behind a 500", async () => {
    vi.mocked(bookByToken).mockRejectedValue(new Error("db down: secret detail"));
    const res = await post({ action: "book", startsAt: START });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
