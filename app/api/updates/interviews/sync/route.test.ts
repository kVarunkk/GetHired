import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { syncCalendarInterviews } from "@/helpers/interviews/calendar-sync";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "https://app.test" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/calendar/active-provider", () => ({ calendarProvider: vi.fn(() => ({ provider: true })) }));
vi.mock("@/helpers/interviews/calendar-sync", () => ({ syncCalendarInterviews: vi.fn() }));

const quiet = { completed: 2, checked: 3, moved: 1, cancelled: 0, responses: 1, skipped: 0, expired: 0, failures: [] };
const run = (handler = GET, secret: string | null = "test-secret") =>
  handler(
    buildRequest("/api/updates/interviews/sync", {
      method: handler === POST ? "POST" : "GET",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe("/api/updates/interviews/sync (IVT-046)", () => {
  it("needs the internal secret", async () => {
    expect((await run(GET, null)).status).toBe(401);
    expect((await run(GET, "wrong")).status).toBe(401);
    expect(syncCalendarInterviews).not.toHaveBeenCalled();
  });

  it("syncs with the service role and the provider, and emails nothing when all went well", async () => {
    vi.mocked(syncCalendarInterviews).mockResolvedValue(quiet);
    const res = await run(POST);
    expect(await res.json()).toEqual({ ...quiet, failures: 0 });
    expect(syncCalendarInterviews).toHaveBeenCalledWith({ service: true }, { provider: true });
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("emails one summary of the interviews that failed", async () => {
    vi.mocked(syncCalendarInterviews).mockResolvedValue({ ...quiet, failures: ["i1: boom", "i2: bang"] });
    expect((await run()).status).toBe(200);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("i1: boom\ni2: bang");
  });

  it("reports a failed run", async () => {
    vi.mocked(syncCalendarInterviews).mockRejectedValue(new Error("db down"));
    expect((await run()).status).toBe(500);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toContain("db down");
  });
});
