import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A } from "@/test/utils/team";
import type { EventDetails } from "@/helpers/calendar/events";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { unsubscribeUrl } from "@/helpers/candidates/unsubscribe-token";
import { hashSchedulingToken } from "./scheduling-token";
import { renewSchedulingLink, sendSchedulingLink, type LinkDeps } from "./scheduling-links";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/email/send-company-message", () => ({ sendCompanyMessage: vi.fn() }));
// Production links are https, which the template keeps clickable.
vi.mock("@/utils/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/formatters")>()),
  deploymentUrl: () => "https://gethired.test",
}));
vi.mock("@/helpers/candidates/unsubscribe-token", () => ({
  unsubscribeUrl: vi.fn((id: string) => `https://gethired.test/unsubscribe/candidate/${id}`),
}));

const APP = "e0000000-0000-4000-8000-000000000001";
const INTERVIEW = "f1000000-0000-4000-8000-000000000001";
const TEMPLATE = "70000000-0000-4000-8000-000000000001";
const RITA = "c2000000-0000-4000-8000-000000000001";

let rls: SupabaseMock;
let admin: SupabaseMock;
let deps: LinkDeps;

const details = (overrides: Partial<EventDetails> = {}): EventDetails => ({
  id: INTERVIEW,
  application_id: APP,
  job_post_id: "b0000000-0000-4000-8000-0000000000a1",
  company_id: ADMIN_A.myCompany.id,
  name: "Intro call",
  status: "awaiting_candidate",
  source: "link",
  starts_at: null,
  ends_at: null,
  time_zone: "UTC",
  meeting_url: null,
  provider_event_id: null,
  organizer_user_id: ADMIN_A.user.id,
  organizer_connection_id: "conn",
  candidate_is_attendee: true,
  candidate_name: "Ada Lovelace",
  candidate_email: "ada@example.test",
  job_title: "Backend Engineer",
  company_name: "Acme",
  panel: [],
  ...overrides,
});

const input = { applicationId: APP, name: "Intro call", durationMinutes: 30, panel: [RITA], templateId: TEMPLATE };

/** Queues a happy path up to the RPC; tests change pieces of it. */
function happy({
  template = { id: TEMPLATE, subject: "Pick a time, {{candidate_first_name}}", body_md: "Book here: {{scheduling_link}}" },
  left = 10,
  link = { ok: true, id: INTERVIEW, application_id: APP, status: "awaiting_candidate", expires_at: "2026-11-21T00:00:00Z" },
  event = details(),
  application = { applicant_user_id: "a0000000-0000-4000-8000-000000000001", company_candidate_id: null },
}: {
  template?: object | null;
  left?: number;
  link?: object;
  event?: EventDetails;
  application?: object;
} = {}) {
  rls.queue("company_email_templates", { data: template, error: null });
  rls.queue("company_info", { data: { name: "Acme", email: "jobs@acme.test", logo_url: null }, error: null });
  rls.queue("application_events", { data: null, error: null, count: 300 - left });
  rls.queueRpc("pipeline_emails_pending", { data: 0, error: null });
  rls.queueRpc("create_scheduling_link", { data: link, error: null });
  admin.queueRpc("interview_event_details", { data: event, error: null });
  admin.queue("applications", { data: application, error: null });
  admin.queue("application_events", { data: null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = createSupabaseMock();
  admin = createSupabaseMock();
  deps = { supabase: rls.client, admin: admin.client, user: ADMIN_A.user, company: ADMIN_A.myCompany };
  vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: true });
});

const rpcArgs = (mock: SupabaseMock, fn: string) => mock.callsFor(fn)[0]?.chain[0].args[1] as Record<string, unknown>;

describe("sendSchedulingLink (IVT-062, IV-REQ-020, IV-REQ-026)", () => {
  it("creates the link with only the token's hash and emails the per-interview link", async () => {
    happy();
    const result = await sendSchedulingLink(deps, input);
    expect(result).toMatchObject({ ok: true, id: INTERVIEW, applicationId: APP, expiresAt: "2026-11-21T00:00:00Z" });
    if (!result.ok) throw new Error("expected ok");

    const token = result.url.split("/schedule/")[1];
    expect(token).toMatch(/^[\w-]{43}$/);
    const args = rpcArgs(rls, "create_scheduling_link");
    expect(args).toEqual({
      p_application_id: APP,
      p_panel: [RITA],
      p_token_hash: hashSchedulingToken(token),
      p_name: "Intro call",
      p_duration_minutes: 30,
    });
    expect(JSON.stringify(args)).not.toContain(token);

    const sent = vi.mocked(sendCompanyMessage).mock.calls[0][0];
    expect(sent).toMatchObject({ toEmail: "ada@example.test", subject: "Pick a time, Ada", companyName: "Acme" });
    expect(sent.bodyMd).toBe(`Book here: <${result.url}>`);
    expect(sent.unsubscribeUrl ?? null).toBeNull();
  });

  it("sends a plan interview by its plan item", async () => {
    happy();
    await sendSchedulingLink(deps, { applicationId: APP, planItemId: INTERVIEW, panel: [RITA], templateId: TEMPLATE });
    expect(rpcArgs(rls, "create_scheduling_link")).toMatchObject({ p_plan_item_id: INTERVIEW });
    expect(rpcArgs(rls, "create_scheduling_link")).not.toHaveProperty("p_name");
  });

  it("carries the unsubscribe link for an imported candidate", async () => {
    happy({ application: { applicant_user_id: null, company_candidate_id: "cc-1" } });
    await sendSchedulingLink(deps, input);
    expect(unsubscribeUrl).toHaveBeenCalledWith("cc-1");
    expect(vi.mocked(sendCompanyMessage).mock.calls[0][0].unsubscribeUrl).toBe(
      "https://gethired.test/unsubscribe/candidate/cc-1",
    );
  });

  it("logs the email in the timeline without its body", async () => {
    happy();
    await sendSchedulingLink(deps, input);
    const insert = admin.callsFor("application_events")[0].chain.find((c) => c.method === "insert")!;
    const row = insert.args[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      company_id: ADMIN_A.myCompany.id,
      application_id: APP,
      actor_user_id: ADMIN_A.user.id,
      type: "email_sent",
      payload: { template_id: TEMPLATE, subject: "Pick a time, Ada", scheduled_interview_id: INTERVIEW },
    });
    expect(JSON.stringify(row)).not.toContain("/schedule/");
  });

  it.each([
    ["no_candidate_email", "unsubscribed"],
    ["panel_not_connected", "Google Calendar"],
    ["forbidden", "Your role can't schedule"],
  ])("refuses with the RPC's %s and sends nothing", async (reason, copy) => {
    happy({ link: { ok: false, reason } });
    const result = await sendSchedulingLink(deps, input);
    expect(result).toMatchObject({ ok: false, reason });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain(copy);
    expect(sendCompanyMessage).not.toHaveBeenCalled();
  });

  it("needs {{scheduling_link}} in the message, before creating anything", async () => {
    happy({ template: { id: TEMPLATE, subject: "Hi", body_md: "We'll be in touch." } });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "needs_link" });
    expect(rls.callsFor("create_scheduling_link")).toHaveLength(0);
  });

  it("uses the edited subject and body", async () => {
    happy();
    await sendSchedulingLink(deps, { ...input, subject: "Your call", body: "Pick: {{ scheduling_link }}" });
    expect(vi.mocked(sendCompanyMessage).mock.calls[0][0]).toMatchObject({ subject: "Your call" });
    expect(vi.mocked(sendCompanyMessage).mock.calls[0][0].bodyMd).toMatch(/^Pick: <https:\/\/.+\/schedule\/[\w-]{43}>$/);
  });

  it("refuses unknown variables before creating anything", async () => {
    happy({ template: { id: TEMPLATE, subject: "Hi", body_md: "{{scheduling_link}} {{salary}}" } });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "invalid_template" });
    expect(rls.callsFor("create_scheduling_link")).toHaveLength(0);
  });

  it("refuses a template from another company", async () => {
    happy({ template: null });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "template_not_found" });
    expect(rls.callsFor("company_email_templates")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", ADMIN_A.myCompany.id],
    });
  });

  it("counts against the company's daily email cap", async () => {
    happy({ left: 0 });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "daily_cap" });
    expect(rls.callsFor("create_scheduling_link")).toHaveLength(0);
  });

  it("cancels the interview when the email can't be sent, so no dead link is left waiting", async () => {
    happy();
    rls.queueRpc("cancel_interview", { data: { ok: true }, error: null });
    vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: false, error: "smtp down" });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "email_failed" });
    expect(rpcArgs(rls, "cancel_interview")).toEqual({ p_id: INTERVIEW, p_reason: "email_failed" });
    expect(admin.callsFor("application_events")).toHaveLength(0);
  });

  it("cancels it when the candidate's address is gone by the time it sends (D20)", async () => {
    happy({ event: details({ candidate_email: null }) });
    rls.queueRpc("cancel_interview", { data: { ok: true }, error: null });
    expect(await sendSchedulingLink(deps, input)).toMatchObject({ ok: false, reason: "no_candidate_email" });
    expect(sendCompanyMessage).not.toHaveBeenCalled();
    expect(rls.callsFor("cancel_interview")).toHaveLength(1);
  });

  it("validates the input", async () => {
    expect(await sendSchedulingLink(deps, { ...input, panel: [] })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await sendSchedulingLink(deps, { ...input, name: null })).toMatchObject({ ok: false, reason: "invalid" });
    expect(rls.calls).toHaveLength(0);
  });
});

describe("renewSchedulingLink (IVT-065)", () => {
  const RENEWED = { ok: true, id: INTERVIEW, application_id: APP, status: "awaiting_candidate", expires_at: "2026-11-22T00:00:00Z" };

  it("Copy link: a new token replaces the old one, and nothing is emailed", async () => {
    rls.queueRpc("renew_scheduling_link", { data: RENEWED, error: null });
    const result = await renewSchedulingLink(deps, { interviewId: INTERVIEW });
    expect(result).toMatchObject({ ok: true, emailed: false, applicationId: APP, expiresAt: "2026-11-22T00:00:00Z" });
    if (!result.ok) throw new Error("expected ok");
    const token = result.url.split("/schedule/")[1];
    expect(rpcArgs(rls, "renew_scheduling_link")).toEqual({ p_id: INTERVIEW, p_token_hash: hashSchedulingToken(token) });
    expect(sendCompanyMessage).not.toHaveBeenCalled();
  });

  it("Resend: emails the new link with the template", async () => {
    rls.queue("company_email_templates", { data: { id: TEMPLATE, subject: "Again", body_md: "{{scheduling_link}}" }, error: null });
    rls.queue("company_info", { data: { name: "Acme", email: null, logo_url: null }, error: null });
    rls.queue("application_events", { data: null, error: null, count: 0 });
    rls.queueRpc("pipeline_emails_pending", { data: 0, error: null });
    rls.queueRpc("renew_scheduling_link", { data: RENEWED, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    admin.queue("applications", { data: { applicant_user_id: null, company_candidate_id: "cc-1" }, error: null });
    const result = await renewSchedulingLink(deps, { interviewId: INTERVIEW, email: { templateId: TEMPLATE } });
    expect(result).toMatchObject({ ok: true, emailed: true });
    if (!result.ok) throw new Error("expected ok");
    expect(vi.mocked(sendCompanyMessage).mock.calls[0][0]).toMatchObject({
      bodyMd: `<${result.url}>`,
      unsubscribeUrl: "https://gethired.test/unsubscribe/candidate/cc-1",
    });
  });

  it("keeps the new link to copy when the resend email fails", async () => {
    rls.queue("company_email_templates", { data: { id: TEMPLATE, subject: "Again", body_md: "{{scheduling_link}}" }, error: null });
    rls.queue("company_info", { data: { name: "Acme", email: null, logo_url: null }, error: null });
    rls.queue("application_events", { data: null, error: null, count: 0 });
    rls.queueRpc("pipeline_emails_pending", { data: 0, error: null });
    rls.queueRpc("renew_scheduling_link", { data: RENEWED, error: null });
    admin.queueRpc("interview_event_details", { data: details(), error: null });
    admin.queue("applications", { data: { applicant_user_id: "a1", company_candidate_id: null }, error: null });
    vi.mocked(sendCompanyMessage).mockResolvedValue({ ok: false, error: "down" });
    const result = await renewSchedulingLink(deps, { interviewId: INTERVIEW, email: { templateId: TEMPLATE } });
    expect(result).toMatchObject({ ok: true, emailed: false });
    if (!result.ok) throw new Error("expected ok");
    expect(result.warning).toContain("copy the new one");
    expect(rls.callsFor("cancel_interview")).toHaveLength(0);
  });

  it("passes the RPC's refusal on", async () => {
    rls.queueRpc("renew_scheduling_link", { data: { ok: false, reason: "no_candidate_email" }, error: null });
    expect(await renewSchedulingLink(deps, { interviewId: INTERVIEW })).toMatchObject({
      ok: false,
      reason: "no_candidate_email",
    });
  });
});
