import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { OWNER_A } from "@/test/utils/team";
import { templateOf } from "@/test/utils/pipeline";
import { PostHogEvent } from "@/utils/types";
import { deleteTemplate, listTemplates, saveTemplate } from "./email-templates";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const REJECTION = templateOf("rejection");
let db: SupabaseMock;
const ctx = () => ({ supabase: db.client, company: OWNER_A.myCompany, user: COMPANY_A.user });

const argsOf = (method: string) =>
  db
    .callsFor("company_email_templates")
    .flatMap((c) => c.chain.filter((m) => m.method === method))
    .map((m) => m.args);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("listTemplates", () => {
  it("reads only the session company's templates", async () => {
    db.queue("company_email_templates", { data: [REJECTION], error: null });

    expect(await listTemplates(ctx())).toEqual([REJECTION]);
    expect(argsOf("eq")).toEqual([["company_id", COMPANY_A.id]]);
  });
});

describe("saveTemplate", () => {
  it("keeps the fields left out, read from the company's template", async () => {
    db.queue("company_email_templates", {
      data: { name: "Rejection", subject: "About {{job_title}}", body_md: "Old" },
      error: null,
    });
    db.queue("company_email_templates", { data: { id: REJECTION.id, purpose: "rejection" }, error: null });

    expect(await saveTemplate(ctx(), { templateId: REJECTION.id, body: "New" }, { source: "agent" })).toEqual({
      ok: true,
      purpose: "rejection",
    });
    expect(argsOf("update")[0][0]).toMatchObject({ name: "Rejection", subject: "About {{job_title}}", body_md: "New" });
    expect(argsOf("eq")).toContainEqual(["company_id", COMPANY_A.id]);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.PipelineTemplateSaved,
      distinctId: COMPANY_A.user.id,
      properties: { purpose: "rejection", source: "agent" },
    });
  });

  it("checks variables across the merged template", async () => {
    db.queue("company_email_templates", {
      data: { name: "Rejection", subject: "About {{job_title}}", body_md: "Old" },
      error: null,
    });

    expect(await saveTemplate(ctx(), { templateId: REJECTION.id, body: "{{salary}}" }, { source: "agent" })).toEqual({
      ok: false,
      error: "Remove or fix {{salary}}.",
      unknownVariables: ["salary"],
    });
    expect(argsOf("update")).toHaveLength(0);
  });

  it("calls another company's template or a bad id not found", async () => {
    db.queue("company_email_templates", { data: null, error: null });

    expect(await saveTemplate(ctx(), { templateId: REJECTION.id, name: "R" }, { source: "agent" })).toEqual({
      ok: false,
      error: "Template not found.",
    });
    expect(await saveTemplate(ctx(), { templateId: "nope", name: "R" }, { source: "agent" })).toEqual({
      ok: false,
      error: "Template not found.",
    });
    expect(argsOf("update")).toHaveLength(0);
  });
});

describe("deleteTemplate", () => {
  it("refuses a bad id without a query", async () => {
    expect(await deleteTemplate(ctx(), { templateId: "nope" })).toEqual({ ok: false, error: "Template not found." });
    expect(db.callsFor("company_email_templates")).toHaveLength(0);
  });
});
