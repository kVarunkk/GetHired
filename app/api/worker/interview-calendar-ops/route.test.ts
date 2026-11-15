import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { processCalendarOps } from "@/helpers/interviews/calendar-ops";
import { revokePendingCalendars } from "@/helpers/calendar/disconnect";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "https://app.test" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/calendar/active-provider", () => ({ calendarProvider: vi.fn(() => ({ provider: true })) }));
vi.mock("@/helpers/interviews/calendar-ops", () => ({ processCalendarOps: vi.fn() }));
vi.mock("@/helpers/calendar/disconnect", () => ({ revokePendingCalendars: vi.fn() }));

const run = (secret: string | null = "test-secret") =>
  GET(buildRequest("/api/worker/interview-calendar-ops", { headers: secret ? { "X-Internal-Secret": secret } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(revokePendingCalendars).mockResolvedValue({ revoked: 1, failed: 0, gaveUp: 0 });
});

describe("/api/worker/interview-calendar-ops (IVT-047)", () => {
  it("needs the internal secret", async () => {
    expect((await run(null)).status).toBe(401);
    expect(processCalendarOps).not.toHaveBeenCalled();
  });

  it("runs the queued ops, then the pending revocations", async () => {
    vi.mocked(processCalendarOps).mockResolvedValue({ done: 2, dropped: 1, retrying: 0, gaveUp: [] });
    const res = await run();
    expect(await res.json()).toEqual({
      done: 2,
      dropped: 1,
      retrying: 0,
      gaveUp: 0,
      revocations: { revoked: 1, failed: 0, gaveUp: 0 },
    });
    expect(revokePendingCalendars).toHaveBeenCalledWith({ service: true });
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("emails the ops it gave up on", async () => {
    vi.mocked(processCalendarOps).mockResolvedValue({ done: 0, dropped: 0, retrying: 0, gaveUp: ["delete i1: boom"] });
    await run();
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("delete i1: boom");
  });

  it("reports a failed run", async () => {
    vi.mocked(processCalendarOps).mockRejectedValue(new Error("queue down"));
    expect((await run()).status).toBe(500);
  });
});
