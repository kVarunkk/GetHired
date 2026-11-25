import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { gethiredItem, trackerItem } from "@/test/utils/tracker";
import { listMyApplications } from "@/helpers/tracker/list-my-applications";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/tracker/list-my-applications", () => ({ listMyApplications: vi.fn() }));

const get = (searchParams: Record<string, string> = {}) =>
  GET(buildRequest("/api/extension/tracked-applications", { searchParams }));

beforeEach(async () => {
  vi.resetAllMocks();
  await setRequestUser(mockUser(), createSupabaseMock().client);
  vi.mocked(listMyApplications).mockResolvedValue([]);
});

describe("GET /api/extension/tracked-applications", () => {
  it("answers 401 signed out and 403 for a company", async () => {
    await setRequestUser(null);
    expect((await get()).status).toBe(401);
    await setRequestUser(mockUser({ type: "company" }), createSupabaseMock().client);
    expect((await get()).status).toBe(403);
  });

  it("returns the newest applications in the popup's shape", async () => {
    vi.mocked(listMyApplications).mockResolvedValue([
      trackerItem({ id: "t1", jobTitle: "Engineer", companyName: "Acme", appliedAt: "2026-11-10" }),
      gethiredItem({ id: "g1", jobTitle: "Designer", companyName: "Hooli", appliedAt: "2026-11-20" }),
    ]);

    const { applications } = await (await get()).json();

    expect(applications.map((a: { id: string }) => a.id)).toEqual(["g1", "t1"]);
    expect(applications[0]).toEqual({
      id: "g1",
      title: "Designer",
      company: "Hooli",
      statusLabel: expect.any(String),
      appliedAt: "2026-11-20",
      boardUrl: expect.stringContaining("/my-jobs/applications/g1"),
    });
  });

  it("defaults to 5 and clamps the limit to 1..20", async () => {
    vi.mocked(listMyApplications).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => trackerItem({ id: `t${i}`, appliedAt: `2026-11-${String(i + 1).padStart(2, "0")}` })),
    );

    expect((await (await get()).json()).applications).toHaveLength(5);
    expect((await (await get({ limit: "100" })).json()).applications).toHaveLength(20);
    expect((await (await get({ limit: "0" })).json()).applications).toHaveLength(1);
    expect((await (await get({ limit: "abc" })).json()).applications).toHaveLength(5);
  });
});
