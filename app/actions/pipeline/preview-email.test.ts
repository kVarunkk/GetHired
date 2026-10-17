import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { pipelineAppOf } from "@/test/utils/pipeline";
import { previewEmailAction } from "./preview-email";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/email/send-company-message", () => ({ sendCompanyMessage: vi.fn() }));
vi.mock("server-only", () => ({}));

const APP = pipelineAppOf();
let supabase: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  supabase = createSupabaseMock({ user });
  supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, supabase.client);
}

/** The application belongs to the company, which has a scheduling link. */
function ownsApplication() {
  supabase.queue("applications", {
    data: { id: APP.id, user_info: { full_name: "Ada Lovelace" }, job_postings: { title: "Backend Engineer" } },
    error: null,
  });
  supabase.queue("company_info", {
    data: { name: "Acme", scheduling_url: "https://cal.com/acme" },
    error: null,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("previewEmailAction (PLT-063)", () => {
  it("renders with the first selected candidate's real values and sends nothing", async () => {
    ownsApplication();

    const result = await previewEmailAction({
      applicationId: APP.id,
      subject: "{{job_title}} at {{company_name}}",
      body: "Hi {{candidate_first_name}}, book: {{scheduling_link}} {{foo}}",
    });

    expect(result).toEqual({
      ok: true,
      subject: "Backend Engineer at Acme",
      body: "Hi Ada, book: <https://cal.com/acme> {{foo}}",
      unknownVariables: ["foo"],
      missingVariables: [],
    });
    expect(sendCompanyMessage).not.toHaveBeenCalled();
    const [load] = supabase.callsFor("applications");
    expect(load.chain).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
  });

  it("refuses another company's application", async () => {
    supabase.queue("applications", { data: null, error: null });

    expect(await previewEmailAction({ applicationId: APP.id, subject: "x", body: "y" })).toEqual({
      ok: false,
      error: "Application not found.",
    });
  });

  it("refuses a caller who isn't a company, and bad input", async () => {
    expect(await previewEmailAction({ applicationId: "x", subject: "x", body: "y" })).toMatchObject({ ok: false });

    await signIn(mockUser({ type: "applicant" }));
    expect(await previewEmailAction({ applicationId: APP.id, subject: "x", body: "y" })).toMatchObject({
      ok: false,
    });
  });
});
