import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { loadInterviewsCalendar, loadLinkTemplates } from "./scheduler-calendar";

vi.mock("server-only", () => ({}));

const ME = "c2000000-0000-4000-8000-000000000001";
const ADA = "c3000000-0000-4000-8000-000000000001";
const args = { jobId: "j1", applicationId: "a1", userId: ME, userIds: [ADA] };

describe("loadInterviewsCalendar (IVT-045, IVT-048)", () => {
  it("reads the team's statuses, the member's own connection and the D20 answer", async () => {
    const db = createSupabaseMock();
    db.queueRpc("panel_calendar_status", {
      data: [
        { user_id: ME, status: "error" },
        { user_id: ADA, status: "connected" },
      ],
      error: null,
    });
    db.queue("calendar_connections", { data: { status: "error" }, error: null });
    db.queueRpc("interview_candidate_invitable", { data: false, error: null });

    expect(await loadInterviewsCalendar(db.client, args)).toEqual({
      own: "error",
      statuses: { [ME]: "error", [ADA]: "connected" },
      candidateInvitable: false,
    });
    expect(db.callsFor("panel_calendar_status")[0].chain[0].args[1]).toEqual({ p_job_post_id: "j1", p_user_ids: [ADA, ME] });
  });

  it("is empty without access or a connection", async () => {
    const db = createSupabaseMock();
    db.queueRpc("panel_calendar_status", { data: [], error: null });
    db.queue("calendar_connections", { data: null, error: null });
    db.queueRpc("interview_candidate_invitable", { data: null, error: null });
    expect(await loadInterviewsCalendar(db.client, args)).toEqual({ own: null, statuses: {}, candidateInvitable: false });
  });
});

describe("loadLinkTemplates (IVT-065)", () => {
  it("lists the company's interview invite and custom templates, interview invites and the default first", async () => {
    const db = createSupabaseMock();
    db.queue("company_email_templates", {
      data: [
        { id: "c", purpose: "custom", name: "A custom", subject: "s", body_md: "b", is_default: false },
        { id: "i2", purpose: "interview_invite", name: "B invite", subject: "s", body_md: "b", is_default: false },
        { id: "i1", purpose: "interview_invite", name: "Z invite", subject: "s1", body_md: "b1", is_default: true },
      ],
      error: null,
    });
    const templates = await loadLinkTemplates(db.client, "co1");
    expect(templates.map((t) => t.id)).toEqual(["i1", "i2", "c"]);
    expect(templates[0]).toEqual({ id: "i1", name: "Z invite", subject: "s1", body: "b1" });
    const chain = db.callsFor("company_email_templates")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", "co1"] });
    expect(chain).toContainEqual({ method: "in", args: ["purpose", ["interview_invite", "custom"]] });
  });

  it("is empty when the read fails", async () => {
    const db = createSupabaseMock();
    db.queue("company_email_templates", { data: null, error: { message: "nope" } });
    expect(await loadLinkTemplates(db.client, "co1")).toEqual([]);
  });
});
