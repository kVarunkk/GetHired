import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { getEntitlements } from "@/helpers/billing/entitlements";
import {
  billingContactsFor,
  sendCreditsExpiringEmail,
  sendPaymentFailedEmail,
  sendUsageThresholdEmail,
} from "@/helpers/billing/emails";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "cron-secret" }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/billing/emails", () => ({
  billingContactsFor: vi.fn(),
  sendUsageThresholdEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  sendCreditsExpiringEmail: vi.fn(),
}));

const { POST } = await import("./route");

const NOW = new Date("2026-10-14T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

let db: SupabaseMock;

const run = (secret: string | null = "cron-secret") =>
  POST(
    new NextRequest("http://localhost:3000/api/updates/billing", {
      method: "POST",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

function queueRun({
  alerts = [] as unknown[],
  pastDue = [] as unknown[],
  lots = [] as unknown[],
} = {}) {
  db.queueRpc("rollover_free_periods", {
    data: { rolledOver: 2, expiredGrants: 1, graceEnded: 0, paidEnded: 0, expiredLots: 3, releasedHolds: 4 },
    error: null,
  });
  db.queueRpc("billing_usage_alerts", { data: alerts, error: null });
  db.queue("company_subscriptions", { data: pastDue, error: null });
  db.queue("company_credit_ledger", { data: lots, error: null });
}

const alert = (companyId: string, threshold: number, used: number) => ({
  company_id: companyId,
  key: "screenings",
  used,
  amount: 50,
  threshold,
  period_start: "2026-10-01T00:00:00Z",
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(billingContactsFor).mockImplementation(async (id) => ({
    companyName: id === COMPANY_A.id ? "Acme" : "Globex",
    emails: [`billing@${id}.test`],
  }));
  vi.mocked(getEntitlements).mockResolvedValue({
    tier: { id: "t", slug: "startup", name: "Startup" },
    period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
    entitlements: { screenings: { overageCredits: 1 } },
  } as never);
});

afterEach(() => vi.useRealTimers());

describe("POST /api/updates/billing", () => {
  it.each([null, "wrong"])("rejects secret %s with 401", async (secret) => {
    expect((await run(secret)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("rolls over and reports what it did", async () => {
    queueRun();

    const body = await (await run()).json();

    expect(db.callsFor("rollover_free_periods")).toHaveLength(1);
    expect(body).toMatchObject({ rolledOver: 2, expiredLots: 3, releasedHolds: 4, notified: 0 });
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("BILLING CRON"));
  });

  it("emails usage at 80% and 100% once and marks it notified (BL-REQ-022)", async () => {
    queueRun({ alerts: [alert(COMPANY_A.id, 80, 40), alert(COMPANY_B.id, 100, 50)] });

    const body = await (await run()).json();

    expect(body.notified).toBe(2);
    expect(sendUsageThresholdEmail).toHaveBeenCalledWith([`billing@${COMPANY_A.id}.test`], {
      companyName: "Acme",
      label: "screenings",
      used: 40,
      amount: 50,
      threshold: 80,
      resetsAt: "2026-11-01T00:00:00Z",
      canUseCredits: true,
    });
    expect(db.callsFor("mark_usage_notified").map((c) => c.chain[0].args[1])).toEqual([
      { p_company_id: COMPANY_A.id, p_period_start: "2026-10-01T00:00:00Z", p_key: "screenings", p_threshold: 80 },
      { p_company_id: COMPANY_B.id, p_period_start: "2026-10-01T00:00:00Z", p_key: "screenings", p_threshold: 100 },
    ]);

    // The next run: the DB no longer reports them.
    vi.mocked(sendUsageThresholdEmail).mockClear();
    queueRun();
    await run();
    expect(sendUsageThresholdEmail).not.toHaveBeenCalled();
  });

  it("sends grace emails on days 0, 3 and 6 only (BL-REQ-013)", async () => {
    const sub = (id: string, graceIn: number) => ({ company_id: id, grace_until: at(graceIn) });
    queueRun({
      pastDue: [
        sub("day0", 7 * DAY - HOUR),
        sub("day2", 5 * DAY - HOUR),
        sub("day3", 4 * DAY - HOUR),
        sub("day6", 1 * DAY - HOUR),
      ],
    });

    const body = await (await run()).json();

    expect(body.graceEmails).toBe(3);
    const sentTo = vi.mocked(billingContactsFor).mock.calls.map(([id]) => id);
    expect(sentTo).toEqual(["day0", "day3", "day6"]);
    expect(sendPaymentFailedEmail).toHaveBeenCalledWith(["billing@day0.test"], {
      companyName: "Globex",
      planName: "Startup",
      graceUntil: at(7 * DAY - HOUR),
    });
    const filters = db.callsFor("company_subscriptions")[0].chain;
    expect(filters).toContainEqual({ method: "eq", args: ["status", "past_due"] });
  });

  it("warns about credits that enter the 30-day window, one email per company", async () => {
    queueRun({
      lots: [
        { company_id: COMPANY_A.id, remaining: 70, expires_at: at(30 * DAY - 2 * HOUR) },
        { company_id: COMPANY_A.id, remaining: 50, expires_at: at(30 * DAY - 5 * HOUR) },
      ],
    });

    const body = await (await run()).json();

    expect(body.expiryWarnings).toBe(1);
    expect(sendCreditsExpiringEmail).toHaveBeenCalledWith([`billing@${COMPANY_A.id}.test`], {
      companyName: "Acme",
      credits: 120,
      expiresAt: at(30 * DAY - 5 * HOUR),
    });
    const filters = db.callsFor("company_credit_ledger")[0].chain;
    expect(filters).toContainEqual({ method: "gte", args: ["expires_at", at(29 * DAY)] });
    expect(filters).toContainEqual({ method: "lt", args: ["expires_at", at(30 * DAY)] });
  });

  it("keeps going when an email fails, and reports it", async () => {
    vi.mocked(sendUsageThresholdEmail).mockRejectedValueOnce(new Error("smtp down"));
    queueRun({ alerts: [alert(COMPANY_A.id, 80, 40), alert(COMPANY_B.id, 80, 41)] });

    const body = await (await run()).json();

    expect(body.notified).toBe(1);
    expect(body.failures).toEqual([expect.stringContaining("smtp down")]);
    // The failed one isn't marked, so tomorrow's run retries it.
    expect(db.callsFor("mark_usage_notified")).toHaveLength(1);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("Failures"));
  });
});
