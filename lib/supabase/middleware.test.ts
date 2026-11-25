/**
 * Access rules for /agent (TASK-070, RA-TEST-008), plus regression cases pinning the
 * existing behaviour of nearby routes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
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

  it("sends signed-out visitors of the company agent to the company login with a return path", async () => {
    // The prompt itself travels in sessionStorage (helpers/agent/prompt-draft.ts).
    expect(redirectTarget(await updateSession(request("/company/agent?prompt=Hi")))).toBe(
      "/auth/login?company=true&returnTo=%2Fcompany%2Fagent",
    );
    expect(redirectTarget(await updateSession(request("/company")))).toBe("/auth/login?company=true");
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

  it("offers company users who open /agent a candidate account", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    // e.g. the job seeker blog's "Find jobs that match me".
    expect(redirectTarget(await updateSession(request("/agent")))).toBe("/switch-to-applicant");
    expect(redirectTarget(await updateSession(request("/agent?prompt=Find%20jobs")))).toBe(
      "/switch-to-applicant",
    );
  });

  it("offers company users who open the job board a candidate account, but serves a job's page", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);
    expect(redirectTarget(await updateSession(request("/jobs")))).toBe("/switch-to-applicant");
    expect(redirectTarget(await updateSession(request("/jobs?sortBy=relevance")))).toBe("/switch-to-applicant");
    expect(passesThrough(await updateSession(request("/jobs/abc")))).toBe(true);

    vi.mocked(getUserFromRequest).mockResolvedValue(mockUser({ type: "company", onboardingComplete: false }));
    expect(redirectTarget(await updateSession(request("/jobs")))).toBe("/switch-to-applicant");

    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    expect(passesThrough(await updateSession(request("/jobs")))).toBe(true);
  });

  it("keeps applicants out of /company/agent, offering a company account", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/company/agent")))).toBe("/switch-to-company");
  });

  it("sends companies that haven't onboarded from the agent to company onboarding", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(
      mockUser({ type: "company", onboardingComplete: false }),
    );

    // Onboarding sends them on to the company agent when it's done.
    expect(redirectTarget(await updateSession(request("/company/agent?prompt=Hi")))).toBe(
      "/get-started?company=true&returnTo=%2Fcompany%2Fagent",
    );
    // /agent is the applicants' agent, so they're offered a candidate account.
    expect(redirectTarget(await updateSession(request("/agent")))).toBe("/switch-to-applicant");
  });

  it("answers the agent API with 403 for companies that haven't onboarded", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(
      mockUser({ type: "company", onboardingComplete: false }),
    );

    const res = await updateSession(request("/api/agent/chat"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Finish setting up your company first." });
  });

  it.each(["/dashboard", "/settings", "/opportunities", "/interview/abc"])(
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

  it("sends applicants who open a company page to the switch-to-company page", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/company/profiles")))).toBe("/switch-to-company");
  });

  it("sends applicants who open company sign-up or login to the switch-to-company page", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(redirectTarget(await updateSession(request("/auth/sign-up?company=true")))).toBe("/switch-to-company");
    expect(redirectTarget(await updateSession(request("/auth/login?company=true")))).toBe("/switch-to-company");
    expect(redirectTarget(await updateSession(request("/auth/sign-up")))).toBe("/agent");
  });

  it("sends company users who open candidate sign-up to the switch-to-applicant page", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/auth/sign-up")))).toBe("/switch-to-applicant");
    expect(redirectTarget(await updateSession(request("/auth/sign-up?company=true")))).toBe("/company");
    expect(redirectTarget(await updateSession(request("/auth/login")))).toBe("/company");
    expect(passesThrough(await updateSession(request("/switch-to-applicant")))).toBe(true);
  });

  it("serves the switch-to-applicant page to a company that hasn't onboarded", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(mockUser({ type: "company", onboardingComplete: false }));

    expect(passesThrough(await updateSession(request("/switch-to-applicant")))).toBe(true);
  });

  it("lets anyone open the switch-to-company page, and still lets applicants open an invite", async () => {
    expect(passesThrough(await updateSession(request("/switch-to-company")))).toBe(true);
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    expect(passesThrough(await updateSession(request("/switch-to-company")))).toBe(true);
    expect(passesThrough(await updateSession(request("/company/join?token=abc")))).toBe(true);
  });

  it("sends users without a role from company pages to the job board, since the agent needs one", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });

    expect(redirectTarget(await updateSession(request("/company")))).toBe("/jobs");
  });
});

describe("middleware: the landing page", () => {
  it("sends signed-in companies from / to the company dashboard", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(redirectTarget(await updateSession(request("/?utm_source=x")))).toBe("/company");
  });

  it("sends companies that haven't onboarded from / straight to company onboarding", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(mockUser({ type: "company", onboardingComplete: false }));

    expect(redirectTarget(await updateSession(request("/")))).toBe("/get-started?company=true");
  });

  it("still serves / to signed-out visitors, applicants and users without a role", async () => {
    expect(passesThrough(await updateSession(request("/")))).toBe(true);

    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    expect(passesThrough(await updateSession(request("/")))).toBe(true);

    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });
    expect(passesThrough(await updateSession(request("/")))).toBe(true);
  });

  it("still serves /hire to signed-in companies", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(passesThrough(await updateSession(request("/hire")))).toBe(true);
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
});

describe("middleware: bearer tokens (MCP-SEC-006, MCP TASK-000)", () => {
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
  // The middleware only decodes the payload, so any key will do.
  const jwt = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(applicant.id)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("test-secret"));

  it("treats a gh_ key as an ordinary signed-out request", async () => {
    // gh_ keys are gone: no 403 and no pass-through as a token.
    expect(redirectTarget(await updateSession(request("/api/resumes", bearer("gh_abc123"))))).toMatch(
      /^\/auth\/login/,
    );
    expect(redirectTarget(await updateSession(request("/api/agent/chat", bearer("gh_abc123"))))).toMatch(
      /^\/auth\/login/,
    );
    // A public route still answers, as it would for anyone signed out.
    expect(passesThrough(await updateSession(request("/api/jobs", bearer("gh_abc123"))))).toBe(true);
    expect(getUserFromRequest).toHaveBeenCalled();
  });

  it.each(["/api/jobs", "/api/agent/chat", "/dashboard", "/api/resumes/22222222-2222-4222-8222-222222222222/export"])(
    "refuses an OAuth app token (client_id) on %s",
    async (path) => {
      vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
      const token = await jwt({ client_id: "client-1", aud: "authenticated" });

      const res = await updateSession(request(path, bearer(token)));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "OAuth app tokens can only be used with the MCP endpoint",
      });
    },
  );

  it("lets an OAuth app token through to /api/mcp (the route verifies it)", async () => {
    const token = await jwt({ client_id: "client-1", aud: "authenticated" });

    expect(passesThrough(await updateSession(request("/api/mcp", bearer(token))))).toBe(true);
    expect(getUserFromRequest).not.toHaveBeenCalled();
  });

  it("handles a bearer JWT without client_id as before", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    const token = await jwt({ aud: "authenticated" });

    expect(passesThrough(await updateSession(request("/api/agent/chat", bearer(token))))).toBe(true);
  });

  it("lets requests without a token reach /api/mcp, which answers with its own 401 (TASK-033)", async () => {
    expect(passesThrough(await updateSession(request("/api/mcp")))).toBe(true);
    expect(passesThrough(await updateSession(request("/api/mcp", bearer("gh_abc123"))))).toBe(true);
  });

  it("serves the protected resource metadata and the MCP docs page to anyone (TASK-033)", async () => {
    expect(passesThrough(await updateSession(request("/.well-known/oauth-protected-resource")))).toBe(true);
    expect(
      passesThrough(await updateSession(request("/.well-known/oauth-protected-resource/api/mcp"))),
    ).toBe(true);
    expect(passesThrough(await updateSession(request("/mcp")))).toBe(true);
    expect(passesThrough(await updateSession(request("/mcp-server")))).toBe(true);
    expect(passesThrough(await updateSession(request("/mcp-server/companies")))).toBe(true);
  });

  it("keeps the OAuth app token lockdown on the metadata paths", async () => {
    const token = await jwt({ client_id: "client-1", aud: "authenticated" });

    expect((await updateSession(request("/mcp", bearer(token)))).status).toBe(403);
  });

  it("handles a malformed bearer as before", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(passesThrough(await updateSession(request("/api/agent/chat", bearer("not.a.jwt"))))).toBe(
      true,
    );
  });
});

describe("middleware: screening interview routes", () => {
  it("lets the voice callback and the crons through without a session (each checks its own secret)", async () => {
    for (const path of [
      "/api/internal/interview-transcript",
      "/api/updates/screening-interviews",
      "/api/updates/screening-interviews/retention",
    ]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(true);
    }
  });

  it("keeps the candidate's screening page applicant-only (SIT-053)", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);
    expect(redirectTarget(await updateSession(request("/interview/screening/ai1")))).toBe("/auth/login");

    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    expect(passesThrough(await updateSession(request("/interview/screening/ai1")))).toBe(true);
  });

  it("keeps the screening start route behind a session", async () => {
    expect(passesThrough(await updateSession(request("/api/interview/screening/start")))).toBe(false);
  });
});

describe("middleware: multiposting (MP-CON-002, MPT-030)", () => {
  it("lets feeds, the IndexNow key, the workers and board webhooks through without a session", async () => {
    for (const path of [
      "/feeds/jooble.xml",
      "/indexnow-key",
      "/api/worker/feeds",
      "/api/worker/index-pings",
      "/api/webhooks/jobboards/indeed",
    ]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(true);
    }
  });

  it("doesn't open the bare prefixes", async () => {
    for (const path of ["/feeds/", "/api/webhooks/jobboards/", "/api/webhooks/other"]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(false);
    }
  });
});

describe("middleware: the profiles rerank route is gone (QF-REQ-002)", () => {
  it("doesn't treat /api/ai-search/profiles as public", async () => {
    expect(passesThrough(await updateSession(request("/api/ai-search/profiles")))).toBe(false);
  });
});

describe("middleware: bulk import routes", () => {
  it("lets the resume worker and the expiry cron through without a session (each checks its own secret)", async () => {
    for (const path of ["/api/worker/candidate-import", "/api/updates/candidate-imports/expire"]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(true);
    }
  });

  it("keeps the import pages behind a session", async () => {
    expect(passesThrough(await updateSession(request("/company/candidates/import")))).toBe(false);
    expect(passesThrough(await updateSession(request("/company/job-posts/j1/import")))).toBe(false);
  });
});

describe("middleware: candidate pool routes", () => {
  it("lets the candidate embeddings worker through without a session (it checks its own secret)", async () => {
    expect(passesThrough(await updateSession(request("/api/worker/candidate-embeddings")))).toBe(true);
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

describe("middleware: careers pages (CP-SEC-001, CPT-048)", () => {
  it.each(["/careers/acme", "/careers/acme/jobs/d0000000-0000-4000-8000-000000000001", "/api/careers/acme/jobs"])(
    "lets %s through without a session",
    async (path) => {
      expect(passesThrough(await updateSession(request(path)))).toBe(true);
    },
  );

  it("keeps the bare /careers path private", async () => {
    expect(redirectTarget(await updateSession(request("/careers")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: candidate unsubscribe links (BIT-060, BI-CON-004)", () => {
  it("lets an unsubscribe link through without a session", async () => {
    expect(passesThrough(await updateSession(request("/unsubscribe/candidate/abc.def")))).toBe(true);
  });

  it("keeps the bare path private", async () => {
    expect(redirectTarget(await updateSession(request("/unsubscribe/candidate/")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: job alert pause links (JAT-033, JA-REQ-036)", () => {
  it("lets the pause page and the one-click POST through without a session", async () => {
    expect(passesThrough(await updateSession(request("/unsubscribe/alert/abc.def")))).toBe(true);
    expect(passesThrough(await updateSession(request("/api/job-alerts/pause/abc.def")))).toBe(true);
  });

  it("keeps the bare paths private", async () => {
    expect(redirectTarget(await updateSession(request("/unsubscribe/alert/")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: claim links (BIT-064, BI-REQ-041)", () => {
  it("lets a claim link through without a session, so it can offer sign-up", async () => {
    expect(passesThrough(await updateSession(request("/claim/abcdefghijklmnopqrstuvwxyz")))).toBe(true);
  });

  it("keeps the bare path private", async () => {
    expect(redirectTarget(await updateSession(request("/claim/")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: self-scheduling links (IVT-063, IV-SEC-007)", () => {
  it("lets the link's page and its API through without a session", async () => {
    expect(passesThrough(await updateSession(request("/schedule/abcdefghijklmnopqrstuvwxyz")))).toBe(true);
    expect(passesThrough(await updateSession(request("/api/schedule/abcdefghijklmnopqrstuvwxyz")))).toBe(true);
  });

  it("keeps the bare paths private", async () => {
    expect(redirectTarget(await updateSession(request("/schedule/")))).toMatch(/^\/auth\/login/);
    expect(redirectTarget(await updateSession(request("/schedule")))).toMatch(/^\/auth\/login/);
  });
});

describe("middleware: matching workers", () => {
  it("lets the match explanations worker through without a session", async () => {
    expect(
      passesThrough(await updateSession(request("/api/updates/company/match-explanations/worker"))),
    ).toBe(true);
  });

  it("lets the knockout email worker through without a session (CPT-032)", async () => {
    expect(passesThrough(await updateSession(request("/api/updates/knockouts/worker")))).toBe(true);
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

describe("middleware: /company/join (TM-TEST-004, teams difference 4)", () => {
  const JOIN = "/company/join?token=tok_abcdefghijklmnopqrstuvwxyz";
  const invitee = mockUser({ type: "company", onboardingComplete: false });

  it("serves the join page to signed-out visitors instead of sending them to login", async () => {
    expect(passesThrough(await updateSession(request(JOIN)))).toBe(true);
  });

  it("serves it to an applicant, who is still kept out of /company", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);

    expect(passesThrough(await updateSession(request(JOIN)))).toBe(true);
    expect(redirectTarget(await updateSession(request("/company")))).toBe("/switch-to-company");
  });

  it("serves it to a company account that hasn't accepted yet, which is still sent to onboarding from /company", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(invitee);

    expect(passesThrough(await updateSession(request(JOIN)))).toBe(true);
    expect(redirectTarget(await updateSession(request("/company")))).toBe("/get-started?company=true");
  });

  it("lets an accepted member (onboarded, owning no company) reach /company, not onboarding", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);

    expect(passesThrough(await updateSession(request("/company")))).toBe(true);
    expect(passesThrough(await updateSession(request("/company/applications")))).toBe(true);
  });

  it("serves it to a user without a role", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });

    expect(passesThrough(await updateSession(request(JOIN)))).toBe(true);
  });
});

describe("middleware: markdown versions of public pages", () => {
  const rewriteTarget = (res: Response) => {
    const target = res.headers.get("x-middleware-rewrite");
    return target ? new URL(target).pathname : null;
  };

  it("rewrites .md pages to the markdown route for signed-out visitors", async () => {
    expect(rewriteTarget(await updateSession(request("/hire.md")))).toBe("/md/hire");
    expect(rewriteTarget(await updateSession(request("/index.md")))).toBe("/md/index");
    expect(rewriteTarget(await updateSession(request("/pricing/companies.md")))).toBe("/md/pricing/companies");
    expect(rewriteTarget(await updateSession(request("/blog/some-post.md")))).toBe("/md/blog/some-post");
    expect(getUserFromRequest).not.toHaveBeenCalled();
  });

  it("leaves other .md paths to the usual rules", async () => {
    expect(redirectTarget(await updateSession(request("/dashboard.md")))).toMatch(/^\/auth\/login/);
  });

  it("serves markdown from the page's own URL when the client asks for it", async () => {
    const md = { headers: { accept: "text/markdown" } };
    expect(rewriteTarget(await updateSession(request("/", md)))).toBe("/md/index");
    expect(rewriteTarget(await updateSession(request("/hire", md)))).toBe("/md/hire");
    expect(rewriteTarget(await updateSession(request("/blog/some-post", md)))).toBe("/md/blog/some-post");
    expect(getUserFromRequest).not.toHaveBeenCalled();
  });

  it("keeps serving HTML to browsers and varies on Accept", async () => {
    const browser = { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } };
    const res = await updateSession(request("/hire", browser));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("vary")).toContain("Accept");
  });

  it("doesn't negotiate other pages", async () => {
    const md = { headers: { accept: "text/markdown" } };
    const res = await updateSession(request("/dashboard", md));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });
});

describe("middleware: Google Calendar routes (IVT-035, IV-SEC-007)", () => {
  it("keeps the connect and callback routes behind a session", async () => {
    for (const path of ["/api/calendar/google/connect", "/api/calendar/google/callback"]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(false);
    }
  });

  it("lets a signed-in company member reach them", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);
    expect(passesThrough(await updateSession(request("/api/calendar/google/callback?code=x&state=y")))).toBe(true);
  });
});

describe("middleware: interview calendar crons (IVT-046, IVT-047)", () => {
  it("lets the sync cron and the calendar ops worker through without a session (each checks its secret)", async () => {
    for (const path of ["/api/updates/interviews/sync", "/api/updates/interviews/feedback", "/api/worker/interview-calendar-ops"]) {
      expect(passesThrough(await updateSession(request(path))), path).toBe(true);
    }
  });
});

describe("My Jobs (AT-REQ-010)", () => {
  it.each(["/my-jobs", "/my-jobs/applications/10000000-0000-4000-8000-000000000001"])(
    "sends signed-out visitors from %s to login",
    async (path) => {
      vi.mocked(getUserFromRequest).mockResolvedValue(null);
      expect(redirectTarget(await updateSession(request(path)))).toBe(`/auth/login?returnTo=${encodeURIComponent(path)}`);
    },
  );

  it.each(["/my-jobs", "/my-jobs/applications/abc"])("sends a company from %s to switch accounts", async (path) => {
    vi.mocked(getUserFromRequest).mockResolvedValue(company);
    expect(redirectTarget(await updateSession(request(path)))).toBe("/switch-to-applicant");
  });

  it("lets an applicant in", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(applicant);
    const res = await updateSession(request("/my-jobs"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a user without a role to login", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ ...applicant, app_metadata: {} });
    expect(redirectTarget(await updateSession(request("/my-jobs")))).toBe("/auth/login");
  });
});
