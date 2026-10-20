import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const NOW = new Date("2026-10-19T00:00:00.000Z");
let db: SupabaseMock;

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/screening-interviews/retention", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/updates/screening-interviews/retention (SI-SEC-008)", () => {
  it("401 without the secret", async () => {
    expect((await run(null)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("deletes the screening sessions (and so the reports) of jobs closed over a year ago", async () => {
    db.queue("job_postings", { data: [{ id: "j-old" }], error: null });
    db.queue("application_interviews", { data: [{ interview_id: "i1" }, { interview_id: "i2" }], error: null });
    db.queue("interview_sessions", { data: null, error: null, count: 3 });

    const res = await run();

    expect(await res.json()).toEqual({ jobs: 1, sessions: 3 });
    const jobs = db.callsFor("job_postings")[0].chain;
    expect(jobs).toContainEqual({ method: "eq", args: ["status", "inactive"] });
    expect(jobs).toContainEqual({ method: "lt", args: ["updated_at", "2025-10-19T00:00:00.000Z"] });
    // Only the screening interviews of those jobs: practice ones never have an application_interviews row.
    expect(db.callsFor("application_interviews")[0].chain).toContainEqual({ method: "in", args: ["job_post_id", ["j-old"]] });
    const del = db.callsFor("interview_sessions")[0].chain;
    expect(del[0].method).toBe("delete");
    expect(del).toContainEqual({ method: "in", args: ["interview_id", ["i1", "i2"]] });
  });

  it("honours SI_RETENTION_DAYS", async () => {
    vi.stubEnv("SI_RETENTION_DAYS", "30");
    db.queue("job_postings", { data: [], error: null });
    await run();
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "lt", args: ["updated_at", "2026-09-19T00:00:00.000Z"] });
  });

  it("does nothing when no job is old enough", async () => {
    db.queue("job_postings", { data: [], error: null });
    expect(await (await run()).json()).toEqual({ jobs: 0, sessions: 0 });
    expect(db.callsFor("interview_sessions")).toHaveLength(0);
  });
});
