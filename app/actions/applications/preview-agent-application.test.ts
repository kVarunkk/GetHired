import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { previewAgentApplicationAction } from "./preview-agent-application";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const Q1 = "00000000-0000-4000-8000-000000000001";
const Q2 = "00000000-0000-4000-8000-000000000002";

const FORM = {
  version: 1,
  questions: [
    { id: Q1, type: "long_text", label: "Why us?", required: true },
    { id: Q2, type: "yes_no", label: "Can you relocate?", required: false },
  ],
  standard_fields: {},
};

let supabase: SupabaseMock;

function queueTarget({ applied = false } = {}) {
  supabase.queue("all_jobs", {
    data: { id: JOB_ID, job_name: "Engineer", company_name: "Acme", is_platform_job: true },
    error: null,
  });
  supabase.queue("job_postings", { data: { status: "active", questions: [], application_form: FORM }, error: null });
  supabase.queue("resumes", { data: { id: RESUME_ID, name: "Main" }, error: null });
  supabase.queue("applications", { data: applied ? [{ id: "a1" }] : [], error: null });
}

const WRITES = ["insert", "update", "upsert", "delete"];

beforeEach(async () => {
  vi.clearAllMocks();
  supabase = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, supabase.client);
});

describe("previewAgentApplicationAction", () => {
  it("shows each answer under the question's label from the database", async () => {
    queueTarget();

    const result = await previewAgentApplicationAction({
      jobId: JOB_ID,
      answers: [{ key: Q1, value: "The mission" }],
    });

    expect(result).toEqual({
      ok: true,
      job: { title: "Engineer", company: "Acme" },
      resume: "Main",
      answers: [
        { key: Q1, label: "Why us?", text: "The mission" },
        { key: Q2, label: "Can you relocate?", text: null },
      ],
    });
    // Previewing writes nothing.
    expect(supabase.calls.some((c) => c.chain.some((m) => WRITES.includes(m.method)))).toBe(false);
  });

  it("lists the answers that would be refused, by label", async () => {
    queueTarget();

    const result = await previewAgentApplicationAction({
      jobId: JOB_ID,
      answers: [{ key: Q2, value: "maybe" }],
    });

    expect(result).toEqual({
      ok: false,
      error: "Some answers need fixing.",
      fieldErrors: [
        { label: "Why us?", error: "This question is required." },
        { label: "Can you relocate?", error: "Answer yes or no." },
      ],
    });
  });

  it("says so when the user already applied", async () => {
    queueTarget({ applied: true });
    const result = await previewAgentApplicationAction({ jobId: JOB_ID, answers: [] });
    expect(result).toEqual({ ok: false, error: "You've already applied to this job." });
  });

  it("refuses companies, signed-out users and bad input", async () => {
    await setRequestUser(COMPANY_A.user);
    expect(await previewAgentApplicationAction({ jobId: JOB_ID, answers: [] })).toMatchObject({ ok: false });
    await setRequestUser(null);
    expect(await previewAgentApplicationAction({ jobId: JOB_ID, answers: [] })).toMatchObject({ ok: false });
    await setRequestUser(PUBLIC_APPLICANT.user, supabase.client);
    expect(await previewAgentApplicationAction({ jobId: "x" })).toEqual({
      ok: false,
      error: "Couldn't read this application.",
    });
    expect(supabase.calls).toHaveLength(0);
  });
});
