/**
 * Access rules for /agent (TASK-070), plus regression cases pinning the
 * existing behaviour of nearby routes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { updateSession } from "./middleware";
import { mockUser } from "@/test/utils/auth";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/utils/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/utils")>()),
  hasEnvVars: true,
}));

const request = (path: string, init: { headers?: Record<string, string> } = {}) => {
  const req = new NextRequest(new URL(path, "http://localhost:3000"), init);
  vi.mocked(headers).mockResolvedValue(req.headers as never);
  return req;
};

const redirectTarget = (res: Response) => {
  const location = res.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return url.pathname + url.search;
};

const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

const applicant = mockUser({ type: "applicant" });
const company = mockUser({ type: "company", onboardingComplete: true });

beforeEach(() => {
  vi.mocked(getUserFromRequest).mockResolvedValue(null);
});

describe("middleware: /agent", () => {
  it("sends signed-out visitors to login with a return path", async () => {
    const res = await updateSession(request("/agent"));

    expect(redirectTarget(res)).toBe("/auth/login?returnTo=%2Fagent");
  });

  it("drops the query from the return path, like other pages", async () => {
    const res = await updateSession(request("/agent?session=abc"));

    expect(redirectTarget(res)).toBe("/auth/login?returnTo=%2Fagent");
  });

  it("lets applicants through", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(passesThrough(await updateSession(request("/agent")))).toBe(true);
  });

  it("redirects company users away", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/agent")))).toBe("/auth/login");
  });

  it("lets applicants call the agent API", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(passesThrough(await updateSession(request("/api/agent/chat")))).toBe(true);
  });

  it("rejects gh_ API tokens on the agent API", async () => {
    const res = await updateSession(
      request("/api/agent/chat", { headers: { Authorization: "Bearer gh_abc123" } }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "API tokens can only be used with API routes" });
  });
});

describe("middleware: regressions", () => {
  it("sends signed-out visitors from /dashboard to login", async () => {
    expect(redirectTarget(await updateSession(request("/dashboard")))).toBe(
      "/auth/login?returnTo=%2Fdashboard",
    );
  });

  it("keeps /jobs public", async () => {
    expect(passesThrough(await updateSession(request("/jobs")))).toBe(true);
  });

  it("keeps the dashboard applicant-only", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/dashboard")))).toBe("/auth/login");
  });

  it("still allows gh_ tokens on their API routes", async () => {
    const res = await updateSession(
      request("/api/jobs", { headers: { Authorization: "Bearer gh_abc123" } }),
    );

    expect(passesThrough(res)).toBe(true);
  });
});
