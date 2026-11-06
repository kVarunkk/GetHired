import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { getScreeningInviteForApplication } from "@/helpers/interview/screening/my-interviews";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { submitApplication } from "./submit-application";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/resumes/upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));
vi.mock("@/helpers/applications/knockout-reject", () => ({ KNOCKOUT_EMAIL_DELAY_MS: 1, rejectForKnockout: vi.fn() }));
vi.mock("@/helpers/interview/screening/my-interviews", () => ({ getScreeningInviteForApplication: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" } as User;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const INPUT = { allJobsId: JOB_ID, resumeId: RESUME_ID, answers: {} };

const content = (text: string) => ({
  version: 2,
  sections: [{ id: "s1", type: "experience", items: [{ id: "i1", bullets: [{ id: "b1", text }] }] }],
});

const RESUME = {
  id: RESUME_ID,
  name: "Backend",
  content: content("Built it"),
  contact: { fullName: "Ada", email: "ada@example.com", links: [] },
  template: "compact",
  revision: 2,
  schema_version: 2,
  resume_path: null,
};

const JOB = { id: "job-post", job_id: JOB_ID, company_id: "c1", status: "active", questions: [], application_form: null };

let db: SupabaseMock;
let service: SupabaseMock;

const seedJob = () => {
  service.queue("job_postings", { data: JOB, error: null });
  service.queue("applications", { data: [], error: null });
  service.queue("applications", { data: { id: "app1" }, error: null });
};

const inserted = () =>
  service
    .callsFor("applications")
    .flatMap((call) => call.chain)
    .find((step) => step.method === "insert")?.args[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(getScreeningInviteForApplication).mockResolvedValue(null);
  vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });
});

describe("submitApplication", () => {
  it("writes the application and charges for it, as before", async () => {
    db.queue("resumes", { data: RESUME, error: null });
    seedJob();

    const result = await submitApplication(db.client, USER, INPUT);

    expect(result).toEqual({ ok: true, applicationId: "app1", creditsDeducted: true, interview: null });
    expect(inserted()).toMatchObject({
      job_post_id: "job-post",
      all_jobs_id: JOB_ID,
      applicant_user_id: USER.id,
      resume_id: RESUME_ID,
      status: "submitted",
      source: "applied",
    });
    expect(deductUserCreditsHelper).toHaveBeenCalledTimes(1);
  });

  it("refuses a resume that isn't the user's", async () => {
    db.queue("resumes", { data: null, error: null });

    expect(await submitApplication(db.client, USER, INPUT)).toEqual({ ok: false, error: "Pick one of your resumes." });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(service.calls).toHaveLength(0);
  });

  it("keeps the resume in both snapshots (RE-REQ-061)", async () => {
    db.queue("resumes", { data: RESUME, error: null });
    seedJob();

    await submitApplication(db.client, USER, INPUT);

    expect(inserted().resume_snapshot).toEqual({ name: "Backend", template: "compact", content: RESUME.content });
    expect(inserted().resume_contact_snapshot).toEqual(RESUME.contact);
  });

  it("upgrades a version 1 resume first, and snapshots the result (RE-REQ-095)", async () => {
    db.queue("resumes", { data: { ...RESUME, schema_version: 1, contact: null, resume_path: "u/r.pdf" }, error: null });
    db.queue("resumes", { data: { ...RESUME, content: content("Upgraded") }, error: null });
    seedJob();

    await submitApplication(db.client, USER, INPUT);

    expect(upgradeResumeFromFile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(inserted().resume_snapshot)).toContain("Upgraded");
    expect(inserted().resume_contact_snapshot).toEqual(RESUME.contact);
  });

  it.each([
    ["fails", () => vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "No file." })],
    ["throws", () => vi.mocked(upgradeResumeFromFile).mockRejectedValue(new Error("Boom"))],
  ])("snapshots what it has and still applies when the upgrade %s", async (_, arrange) => {
    arrange();
    db.queue("resumes", { data: { ...RESUME, schema_version: 1, contact: null }, error: null });
    seedJob();

    const result = await submitApplication(db.client, USER, INPUT);

    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(inserted().resume_snapshot)).toContain("Built it");
    expect(inserted().resume_contact_snapshot).toBeNull();
  });

  it("doesn't upgrade for an application that won't go through", async () => {
    db.queue("resumes", { data: { ...RESUME, schema_version: 1 }, error: null });
    service.queue("job_postings", { data: { ...JOB, status: "closed" }, error: null });

    expect(await submitApplication(db.client, USER, INPUT)).toMatchObject({ ok: false });
    expect(upgradeResumeFromFile).not.toHaveBeenCalled();
  });
});
