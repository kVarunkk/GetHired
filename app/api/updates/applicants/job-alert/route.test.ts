import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { runJobAlert } from "@/helpers/job-alerts/run-alert";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { flushAfter } from "@/test/utils/after";
import { GET } from "./route";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/job-alerts/run-alert", () => ({ runJobAlert: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

let db: SupabaseMock;

const withSecret = (secret: string | null) =>
  vi.mocked(headers).mockResolvedValue(new Headers(secret ? { "X-Internal-Secret": secret } : {}) as never);

const row = (id: string, frequency: "daily" | "weekly", email = `${id}@example.com`) => ({
  id,
  user_id: `u-${id}`,
  name: `Alert ${id}`,
  url: "/jobs?location=pune",
  filters: { location: ["pune"] },
  frequency,
  created_at: "2026-11-01T00:00:00Z",
  last_checked_at: null,
  user_info: { email, full_name: null },
});

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  withSecret("test-secret");
  vi.useFakeTimers({ toFake: ["Date"] });
});

describe("GET /api/updates/applicants/job-alert (JAT-034)", () => {
  it("rejects a bad secret", async () => {
    withSecret("nope");
    expect((await GET()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("selects only active, keyed alerts not checked in 20 hours", async () => {
    vi.setSystemTime(new Date("2026-11-25T03:30:00Z"));
    db.queue("bookmarks", { data: [], error: null });
    await GET();
    const chain = db.callsFor("bookmarks")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["is_alert_on", true] });
    expect(chain).toContainEqual({ method: "not", args: ["filters_key", "is", null] });
    expect(chain).toContainEqual({
      method: "or",
      args: ["last_checked_at.is.null,last_checked_at.lt.2026-11-24T07:30:00.000Z"],
    });
  });

  it("skips weekly alerts on a Tuesday and never fetches /api/jobs", async () => {
    vi.setSystemTime(new Date("2026-11-24T03:30:00Z"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    db.queue("bookmarks", { data: [row("a", "daily"), row("b", "weekly")], error: null });
    vi.mocked(runJobAlert).mockResolvedValue({ ok: true, sent: true, jobs: 3, total: 3 });

    await GET();
    await flushAfter();

    expect(vi.mocked(runJobAlert).mock.calls.map(([alert]) => alert.id)).toEqual(["a"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "job_alert_email_sent", distinctId: "u-a" }),
    );
  });

  it("runs weekly alerts on a Monday, keeps going after a failure, and reports by alert id only", async () => {
    vi.setSystemTime(new Date("2026-11-23T03:30:00Z"));
    db.queue("bookmarks", {
      data: [row("a", "weekly"), row("b", "daily"), row("c", "weekly")],
      error: null,
    });
    vi.mocked(runJobAlert)
      .mockRejectedValueOnce(new Error("boom for b@example.com"))
      .mockResolvedValueOnce({ ok: false, error: "send: Email delivery failed to b@example.com" })
      .mockResolvedValueOnce({ ok: true, sent: true, jobs: 4, total: 9 });

    await GET();
    await flushAfter();

    expect(runJobAlert).toHaveBeenCalledTimes(3);
    const report = vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0];
    expect(report).toContain("Alerts checked: 3");
    expect(report).toContain("Emails sent: 1");
    expect(report).toContain("Jobs sent: 4");
    expect(report).toContain("Failures: 2");
    expect(report).toContain("- alert a:");
    expect(report).not.toContain("@");
  });
});
