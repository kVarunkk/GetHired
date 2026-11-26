import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { flushAfter } from "@/test/utils/after";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, OWNER_A, memberOf, roleOf } from "@/test/utils/team";
import CompanyPage from "./page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/actions/interviews/remind-interviewers", () => ({ remindInterviewersAction: vi.fn() }));
vi.mock("@/app/actions/interviews/send-scheduling-link", () => ({ renewSchedulingLinkAction: vi.fn() }));
vi.mock("@/app/actions/pipeline/move-applications", () => ({ moveApplicationsAction: vi.fn() }));
vi.mock("@/components/pipeline/MoveDialog", () => ({ default: () => null }));
vi.mock("@/components/jobs/JobPostButtons", () => ({
  CreateJobPostButton: ({ disabled }: { disabled?: boolean }) => <button disabled={disabled}>Create New Job Post</button>,
}));
vi.mock("@/components/agent/recruiter/AskRecruiterAgent", () => ({
  default: ({ suggestions }: { suggestions: { label: string }[] }) => (
    <ul aria-label="Suggestions">
      {suggestions.map((s) => (
        <li key={s.label}>{s.label}</li>
      ))}
    </ul>
  ),
}));

const DAY = 86_400_000;
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const CANDIDATE_ID = "cc000000-0000-4000-8000-000000000001";

const importedApplication = {
  id: "app-imported",
  created_at: ago(2),
  source: "imported",
  source_detail: null,
  applicant_user_id: null,
  company_candidate_id: CANDIDATE_ID,
  user_info: null,
  company_candidates: { id: CANDIDATE_ID, full_name: "Meera Iyer", email: null, resume_path: null },
  job_postings: { id: "job-open", title: "Backend Engineer" },
  pipeline_stages: { kind: "applied" },
  application_screenings: { fit_score: 82 },
};

const JOBS = [
  { id: "job-open", title: "Backend Engineer", state: "open", visibility: "public" },
  { id: "job-paused", title: "Designer", state: "paused", visibility: "link_only" },
  { id: "job-draft", title: "Secret Draft", state: "draft", visibility: "public" },
  { id: "job-closed", title: "Old Role", state: "closed", visibility: "public" },
];

const has = (call: RecordedCall, method: string, ...args: unknown[]) =>
  call.chain.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

const ok = (data: unknown, count?: number) => ({ data, error: null, ...(count === undefined ? {} : { count }) });

/** Answers each table by what the query asks for, since the page's reads run together. */
function fallback(call: RecordedCall) {
  if (call.target === "company_info") {
    return ok({
      time_zone: "Asia/Kolkata",
      logo_url: null,
      description: null,
      careers_slug: "acme",
      careers_published: true,
    });
  }
  if (call.target === "applications") {
    return has(call, "eq", "pipeline_stages.kind", "applied") ? ok([importedApplication]) : ok(null, 3);
  }
  if (call.target === "job_postings") {
    const states = call.chain.find((c) => c.method === "in" && c.args[0] === "state")?.args[1] as string[] | undefined;
    return states ? ok(JOBS.filter((j) => states.includes(j.state))) : ok([], 0);
  }
  return ok(null, 0);
}

let db: SupabaseMock;

function use(user = COMPANY_A.user) {
  db = createSupabaseMock({ user, fallback });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

const SUMMARY = { open_jobs: 2, new_today: 1, new_7d: 4, waiting: 5 };
const FUNNEL = {
  stages: [{ kind: "applied", count: 6 }],
  jobs: [],
  needs_attention: [
    {
      application_id: "app-waiting",
      name: "Priya Sharma",
      job_post_id: "job-open",
      job_title: "Backend Engineer",
      stage_entered_at: new Date(Date.now() - 5 * DAY).toISOString(),
    },
  ],
};

function dashboard(membership: unknown = OWNER_A.membership) {
  db.queueRpc("my_company_access", ok(membership));
  db.queueRpc("company_dashboard_summary", ok(SUMMARY));
  db.queueRpc("get_company_funnel", ok(FUNNEL));
}

/** Renders the page and lets its streamed sections arrive. */
async function showDashboard() {
  const page = await CompanyPage();
  await act(async () => {
    render(page);
  });
}

const section = (name: string) => screen.getByRole("region", { name });
const querySection = (name: string) => screen.queryByRole("region", { name });

beforeEach(() => {
  vi.clearAllMocks();
  use();
  vi.mocked(getEntitlements).mockResolvedValue({
    tier: { id: "t", slug: "free", name: "Free" },
    entitlements: Object.fromEntries(
      ["interview_minutes", "agent_messages", "outreach", "resume_imports"].map((key) => [
        key,
        { kind: "allowance", amount: 100, used: 90, held: 0, remaining: key === "outreach" ? 10 : 80, overageCredits: null },
      ]),
    ),
  } as unknown as Awaited<ReturnType<typeof getEntitlements>>);
});

describe("company dashboard header (CD-REQ-010..013)", () => {
  it("greets the member, names the company and sums up what's waiting", async () => {
    dashboard();

    await showDashboard();

    expect(screen.getByRole("heading", { level: 1, name: "How are you doing today, Olive?" })).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("5 applicants waiting")).toBeInTheDocument();
    expect(db.callsFor("company_dashboard_summary")[0].chain[0].args).toEqual(["company_dashboard_summary"]);
  });

  it("puts the company's own prompts ahead of the starters", async () => {
    dashboard();

    await showDashboard();

    const chips = within(screen.getByRole("list", { name: "Suggestions" })).getAllByRole("listitem");
    expect(chips).toHaveLength(4);
    expect(chips[0]).toHaveTextContent("Review the applicant waiting on Backend Engineer");
  });

  it("fails the page only when the summary fails", async () => {
    db.queueRpc("my_company_access", ok(OWNER_A.membership));
    db.queueRpc("company_dashboard_summary", { data: null, error: { message: "boom" } });

    await showDashboard();

    expect(screen.queryByRole("heading", { level: 1, name: /How are you doing/ })).not.toBeInTheDocument();
  });

  it("reports section counts only to analytics (CD-REQ-039)", async () => {
    dashboard();

    await showDashboard();
    await flushAfter();

    const [[event]] = vi.mocked(eventCaptureServer).mock.calls;
    expect(event.properties).toMatchObject({ attention_count: { waiting_in_applied: 1 }, has_setup_checklist: true });
    expect(JSON.stringify(event.properties)).not.toMatch(/Priya|Backend|app-waiting/);
  });
});

describe("company dashboard sections", () => {
  it("names an imported candidate in New applications (CD-REQ-001)", async () => {
    dashboard();

    await showDashboard();

    const list = section("New applications");
    expect(within(list).getByRole("link", { name: /Meera Iyer/ })).toHaveAttribute(
      "href",
      "/company/applications/app-imported",
    );
    expect(list).toHaveTextContent("Backend Engineer · Imported · today");
    expect(list).toHaveTextContent("Fit 82");
  });

  it("leaves merged applications out of every application read (CD-REQ-002/003)", async () => {
    dashboard();

    await showDashboard();

    const reads = db.callsFor("applications");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.chain).toContainEqual({ method: "is", args: ["merged_into_application_id", null] });
    }
    const recent = reads.find((r) => has(r, "eq", "pipeline_stages.kind", "applied"))!;
    expect(String(recent.chain[0].args[0])).toContain("job_postings!inner(id, title)");
    expect(recent.chain).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
  });

  it("counts each open job's applicants in the one jobs query, without merged ones", async () => {
    db = createSupabaseMock({
      user: COMPANY_A.user,
      fallback: (call) =>
        call.target === "job_postings" && has(call, "in", "state", ["open", "paused"])
          ? ok([{ ...JOBS[0], total: [{ count: 12 }], recent: [{ count: 4 }] }])
          : fallback(call),
    });
    vi.mocked(createClient).mockResolvedValue(db.client);
    dashboard();

    await showDashboard();

    const aside = screen.getByRole("complementary", { name: "Your hiring at a glance" });
    expect(aside).toHaveTextContent("12");
    expect(aside).toHaveTextContent("4");
    const jobs = db.callsFor("job_postings").find((c) => has(c, "in", "state", ["open", "paused"]))!;
    expect(String(jobs.chain[0].args[0])).toContain("total:applications(count), recent:applications(count)");
    for (const embed of ["total", "recent"]) {
      expect(jobs.chain).toContainEqual({ method: "is", args: [`${embed}.merged_into_application_id`, null] });
    }
    expect(jobs.chain.some((c) => c.method === "gte" && c.args[0] === "recent.created_at")).toBe(true);
    // Only "New applications" reads the applications table.
    expect(db.callsFor("applications")).toHaveLength(1);
  });

  it("lists open and paused jobs only (CD-REQ-004)", async () => {
    dashboard();

    await showDashboard();

    const aside = screen.getByRole("complementary", { name: "Your hiring at a glance" });
    expect(within(aside).getByRole("link", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(within(aside).getByRole("link", { name: "Designer" })).toBeInTheDocument();
    expect(aside).toHaveTextContent("Paused");
    expect(aside).toHaveTextContent("Link only");
    expect(aside).not.toHaveTextContent("Secret Draft");
    expect(aside).not.toHaveTextContent("Old Role");
  });

  it("shows who has waited in Applied, with Review", async () => {
    dashboard();

    await showDashboard();

    const list = section("Needs attention");
    expect(list).toHaveTextContent("Backend Engineer · 5 days in Applied");
    expect(within(list).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/company/applications/app-waiting");
  });

  it("shows today's interviews and overdue scorecards", async () => {
    dashboard();
    db.queueRpc(
      "list_my_interviews",
      ok([
        {
          interview_id: "iv-soon",
          application_id: "app-1",
          job_title: "Backend Engineer",
          candidate_name: "Arjun Rao",
          name: "Tech screen",
          status: "scheduled",
          starts_at: new Date(Date.now() + 3_600_000).toISOString(),
          ends_at: new Date(Date.now() + 7_200_000).toISOString(),
          meeting_url: "https://meet.example.com/x",
          scorecard_status: "none",
          kit_open: true,
        },
      ]),
    );
    db.queueRpc(
      "interviews_needing_attention",
      ok([
        {
          interview_id: "iv-mine",
          application_id: "app-2",
          job_post_id: "job-open",
          job_title: "Backend Engineer",
          candidate_name: "Nisha",
          interview_name: "System design",
          since: ago(48),
          owed: 1,
          mine: true,
          kind: "feedback_overdue",
        },
      ]),
    );

    await showDashboard();

    const today = section("Today's interviews");
    expect(within(today).getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://meet.example.com/x");
    expect(within(today).getByRole("link", { name: "Interview kit" })).toHaveAttribute(
      "href",
      "/company/interviews/iv-soon",
    );
    expect(within(section("Needs attention")).getByRole("link", { name: "Submit scorecard" })).toHaveAttribute(
      "href",
      "/company/interviews/iv-mine",
    );
    expect(screen.getByText("1 interview today · 5 applicants waiting · 1 scorecard overdue")).toBeInTheDocument();
  });

  it("shows the careers page link (CP-REQ-014)", async () => {
    dashboard();

    await showDashboard();

    expect(screen.getByRole("link", { name: "gethired.devhub.co.in/careers/acme" })).toHaveAttribute(
      "href",
      "/careers/acme",
    );
  });

  it("shows usage to billing viewers, with a low allowance linked to billing (CD-REQ-031)", async () => {
    dashboard();

    await showDashboard();

    expect(screen.getByRole("heading", { name: "Plan and usage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "10 of 100 left" })).toHaveAttribute("href", "/company/billing");
  });

  it("hides usage without billing.view", async () => {
    use(MEMBER_A.user);
    const member = memberOf(COMPANY_A, "custom", { role: roleOf({ grants: new Map([["applicants.view", "all"]]) }) });
    dashboard(member.membership);

    await showDashboard();

    expect(screen.queryByRole("heading", { name: "Plan and usage" })).not.toBeInTheDocument();
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it("still renders when every extra section fails (CD-REQ-036)", async () => {
    const failing = () => ({ data: null, error: { message: "boom" } });
    db = createSupabaseMock({ user: COMPANY_A.user, fallback: failing });
    vi.mocked(createClient).mockResolvedValue(db.client);
    vi.mocked(getEntitlements).mockRejectedValue(new Error("boom"));
    db.queueRpc("my_company_access", ok(OWNER_A.membership));
    db.queueRpc("company_dashboard_summary", ok(SUMMARY));

    await showDashboard();

    expect(screen.getByRole("heading", { level: 1, name: "How are you doing today, Olive?" })).toBeInTheDocument();
    for (const name of ["Today's interviews", "From your candidates", "New applications"]) {
      expect(querySection(name)).not.toBeInTheDocument();
    }
    for (const name of ["Pipeline", "Open jobs", "Careers page", "Plan and usage"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });

  it("shows a member whose role grants nothing the header and their own interviews (CD-REQ-015)", async () => {
    use(MEMBER_A.user);
    const member = memberOf(COMPANY_A, "custom", { role: roleOf({ grants: new Map() }) });
    db.queueRpc("my_company_access", ok(member.membership));
    db.queueRpc("company_dashboard_summary", ok({ open_jobs: 0, new_today: 0, new_7d: 0, waiting: 0 }));
    db.queueRpc(
      "list_my_interviews",
      ok([
        {
          interview_id: "iv-soon",
          application_id: "app-1",
          job_title: "Backend Engineer",
          candidate_name: "Arjun Rao",
          name: "Tech screen",
          status: "scheduled",
          starts_at: new Date(Date.now() + 3_600_000).toISOString(),
          ends_at: new Date(Date.now() + 7_200_000).toISOString(),
          meeting_url: null,
          scorecard_status: "none",
          kit_open: true,
        },
      ]),
    );

    await showDashboard();

    expect(section("Today's interviews")).toHaveTextContent("Arjun Rao");
    for (const name of ["Needs attention", "From your candidates", "New applications"]) {
      expect(querySection(name)).not.toBeInTheDocument();
    }
    for (const name of ["Pipeline", "Open jobs", "Plan and usage"]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
    expect(db.callsFor("get_company_funnel")).toHaveLength(0);
    expect(db.callsFor("applications")).toHaveLength(0);
  });
});

describe("company dashboard for a removed member (TMT-053, difference 14)", () => {
  it("says they're no longer part of a company instead of erroring", async () => {
    use(MEMBER_A.user);
    db.queueRpc("my_company_access", ok(null));

    await showDashboard();

    expect(
      screen.getByText("You're no longer part of a company on GetHired. Ask your team for a new invite."),
    ).toBeInTheDocument();
    expect(db.callsFor("company_dashboard_summary")).toHaveLength(0);
  });
});

describe("company dashboard gating (RP-REQ-016, RPT-024)", () => {
  it("locks Create New Job Post without jobs.create", async () => {
    use(MEMBER_A.user);
    dashboard(memberOf(COMPANY_A, "custom", { role: roleOf({ grants: new Map() }) }).membership);

    await showDashboard();

    expect(screen.getAllByRole("button", { name: "Create New Job Post" })[0]).toBeDisabled();
  });

  it("enables it with jobs.create", async () => {
    dashboard();

    await showDashboard();

    expect(screen.getAllByRole("button", { name: "Create New Job Post" })[0]).toBeEnabled();
  });
});
