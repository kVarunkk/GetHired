/**
 * Access rules for /agent (TASK-070, RA-TEST-008), plus regression cases pinning the
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

  it("lets onboarded company users reach /company/agent and the agent API (RA-TEST-008)", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(passesThrough(await updateSession(request("/company/agent")))).toBe(true);
    expect(passesThrough(await updateSession(request("/company/agent?session=abc")))).toBe(true);
    expect(passesThrough(await updateSession(request("/api/agent/chat")))).toBe(true);
  });

  it("sends company users from /agent to /company/agent, keeping the query", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/agent")))).toBe("/company/agent");
    expect(redirectTarget(await updateSession(request("/agent?prompt=Find%20Go%20devs")))).toBe(
      "/company/agent?prompt=Find%20Go%20devs",
    );
  });

  it("keeps applicants out of /company/agent", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/company/agent")))).toBe("/agent");
  });

  it("sends companies that haven't onboarded from the agent to company onboarding", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(
      mockUser({ type: "company", onboardingComplete: false }),
    );

    expect(redirectTarget(await updateSession(request("/company/agent")))).toBe("/get-started?company=true");
    expect(redirectTarget(await updateSession(request("/agent")))).toBe("/get-started?company=true");
  });

  it("answers the agent API with 403 for companies that haven't onboarded", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(
      mockUser({ type: "company", onboardingComplete: false }),
    );

    const res = await updateSession(request("/api/agent/chat"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Finish setting up your company first." });
  });

  it.each(["/dashboard", "/opportunities", "/resume-review", "/interview/abc"])(
    "keeps %s applicant-only for onboarded companies",
    async (path) => {
      vi.mocked(getUserFromRequest).mockResolvedValue(company);

      expect(redirectTarget(await updateSession(request(path)))).toBe("/auth/login");
    },
  );

  it("still sends users without a role from /agent to login", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });

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

describe("middleware: the agent is the applicant home", () => {
  it("sends signed-in applicants from the login page to the agent", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/auth/login")))).toBe("/agent");
  });

  it("sends signed-in companies from the login page to the company dashboard", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/auth/login")))).toBe("/company");
  });

  it("sends applicants who open a company page to the agent", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/company/profiles")))).toBe("/agent");
  });

  it("sends users without a role from company pages to the job board, since the agent needs one", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });

    expect(redirectTarget(await updateSession(request("/company")))).toBe("/jobs");
  });
});

describe("middleware: regressions", () => {
  it("sends signed-out visitors from /dashboard to login", async () => {
    expect(redirectTarget(await updateSession(request("/dashboard")))).toBe(
      "/auth/login?returnTo=%2Fdashboard",
    );
  });

  it("lets signed-out visitors reach /api/current-user, which answers with a 401", async () => {
    expect(passesThrough(await updateSession(request("/api/current-user")))).toBe(true);
  });

  it("keeps /jobs public", async () => {
    expect(passesThrough(await updateSession(request("/jobs")))).toBe(true);
  });

  it("keeps the dashboard applicant-only", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/dashboard")))).toBe("/auth/login");
  });

  it("keeps interviews applicant-only", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/interview")))).toBe("/auth/login");
    expect(redirectTarget(await updateSession(request("/interview/i1/analysis/s1")))).toBe(
      "/auth/login",
    );
    expect(passesThrough(await updateSession(request("/ai-interview")))).toBe(true);

    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(passesThrough(await updateSession(request("/interview/i1")))).toBe(true);
  });

  it("still allows gh_ tokens on their API routes", async () => {
    const res = await updateSession(
      request("/api/jobs", { headers: { Authorization: "Bearer gh_abc123" } }),
    );

    expect(passesThrough(res)).toBe(true);
  });
});

describe("middleware: billing routes", () => {
  it("lets the billing cron and the grant route through without a session", async () => {
    expect(passesThrough(await updateSession(request("/api/updates/billing")))).toBe(true);
    expect(passesThrough(await updateSession(request("/api/internal/billing/grant")))).toBe(true);
  });

  it("keeps the company pricing page public", async () => {
    expect(passesThrough(await updateSession(request("/pricing/companies")))).toBe(true);
  });

  it("keeps the billing page company-only", async () => {
    expect(redirectTarget(await updateSession(request("/company/billing")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: matching workers", () => {
  it("lets the match explanations worker through without a session", async () => {
    expect(
      passesThrough(await updateSession(request("/api/updates/company/match-explanations/worker"))),
    ).toBe(true);
  });

  it("lets the application screening worker through without a session", async () => {
    expect(passesThrough(await updateSession(request("/api/worker/application-screening")))).toBe(true);
  });

  it.each([
    "/api/worker/company-notifications",
    "/api/updates/company/applicant-digest/enqueue",
    "/api/updates/company/applicant-digest/worker",
    "/api/updates/company/weekly-matches/enqueue",
    "/api/updates/company/weekly-matches/worker",
  ])("lets the pipeline notification route %s through without a session (PLT-072)", async (path) => {
    expect(passesThrough(await updateSession(request(path)))).toBe(true);
  });

  it("lets the outreach expire job through without a session (ORT-035)", async () => {
    expect(passesThrough(await updateSession(request("/api/updates/outreach/expire")))).toBe(true);
  });

  it("keeps the outreach routes and pages behind a login", async () => {
    expect(passesThrough(await updateSession(request("/api/company/outreach")))).toBe(false);
    expect(redirectTarget(await updateSession(request("/company/outreach")))).toMatch(/^\/auth\/login/);
    expect(redirectTarget(await updateSession(request("/opportunities")))).toMatch(/^\/auth\/login/);
  });

  it("keeps the pipeline board route and the settings page behind a login", async () => {
    expect(passesThrough(await updateSession(request("/api/company/job-posts/j1/pipeline")))).toBe(false);
    expect(redirectTarget(await updateSession(request("/company/settings")))).toMatch(/^\/auth\/login/);
  });

  it("keeps the screening routes behind a login", async () => {
    expect(passesThrough(await updateSession(request("/api/company/job-posts/j1/screen")))).toBe(false);
    expect(passesThrough(await updateSession(request("/api/company/applications/a1/screening")))).toBe(false);
  });

  it("keeps the explain route behind a login", async () => {
    expect(passesThrough(await updateSession(request("/api/company/matches/explain")))).toBe(false);
  });
});
