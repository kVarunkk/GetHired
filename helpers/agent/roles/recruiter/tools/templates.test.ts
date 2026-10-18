import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTemplateTools } from "./templates";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type EmailTemplate,
} from "@/helpers/pipeline/email-templates";
import { execTool, inputJsonSchema, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { RA_TEMPLATE_EXCERPT_MAX_CHARS } from "../config";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/pipeline/email-templates", () => ({
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

const REJECTION = "d0000000-0000-4000-8000-000000000001";
const CUSTOM = "d0000000-0000-4000-8000-000000000002";

const template = (overrides: Partial<EmailTemplate>): EmailTemplate => ({
  id: REJECTION,
  purpose: "rejection",
  name: "Rejection",
  subject: "About {{job_title}}",
  body_md: "Hi {{candidate_first_name}}",
  is_default: true,
  ...overrides,
});

let tools: ReturnType<typeof createTemplateTools>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = createTemplateTools(recruiterToolContext(createSupabaseMock().client));
});

/** The context every helper got: the session's company and user (RA-SEC-002). */
const expectSessionCtx = (ctx: unknown) => {
  const { company, user } = ctx as { company: { id: string }; user: { id: string } };
  expect(company.id).toBe(COMPANY_A.id);
  expect(user.id).toBe(COMPANY_A.user.id);
};

describe("email template tool schemas", () => {
  it("never take a company or user id (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("limits fields like the template editor and takes only real purposes", async () => {
    const input = { purpose: "custom", name: "Follow-up", subject: "Hi", body: "Hello" };
    const valid = async (change: object) =>
      (await validateInput(tools.createEmailTemplate, { ...input, ...change })).success;

    expect(await valid({})).toBe(true);
    expect(await valid({ purpose: "hired" })).toBe(false);
    expect(await valid({ name: "x".repeat(61) })).toBe(false);
    expect(await valid({ subject: "x".repeat(151) })).toBe(false);
    expect(await valid({ body: "x".repeat(5001) })).toBe(false);
  });

  it("needs at least one change to update", async () => {
    expect((await validateInput(tools.updateEmailTemplate, { templateId: REJECTION })).success).toBe(false);
    expect((await validateInput(tools.updateEmailTemplate, { templateId: REJECTION, body: "New" })).success).toBe(
      true,
    );
  });
});

describe("listEmailTemplates tool", () => {
  const long = "x".repeat(RA_TEMPLATE_EXCERPT_MAX_CHARS + 10);

  it("lists the company's templates with trimmed messages and the variables", async () => {
    vi.mocked(listTemplates).mockResolvedValue([
      template({}),
      template({ id: CUSTOM, purpose: "custom", name: "Follow-up", body_md: long, is_default: false }),
    ]);

    const result = await execTool(tools.listEmailTemplates, {});

    expectSessionCtx(vi.mocked(listTemplates).mock.calls[0][0]);
    expect(result).toEqual({
      templates: [
        {
          id: REJECTION,
          name: "Rejection",
          purpose: "rejection",
          isDefault: true,
          subject: "About {{job_title}}",
          body: "Hi {{candidate_first_name}}",
        },
        {
          id: CUSTOM,
          name: "Follow-up",
          purpose: "custom",
          isDefault: false,
          subject: "About {{job_title}}",
          body: long.slice(0, RA_TEMPLATE_EXCERPT_MAX_CHARS),
          trimmed: true,
        },
      ],
      variables: ["candidate_first_name", "job_title", "company_name", "scheduling_link", "sender_name"],
    });
  });

  it("returns one template in full, filters by purpose, and calls an unknown id not found", async () => {
    vi.mocked(listTemplates).mockResolvedValue([
      template({}),
      template({ id: CUSTOM, purpose: "custom", body_md: long, is_default: false }),
    ]);

    const one = (await execTool(tools.listEmailTemplates, { templateId: CUSTOM })) as {
      templates: { body: string }[];
    };
    expect(one.templates).toHaveLength(1);
    expect(one.templates[0].body).toBe(long);

    const rejections = (await execTool(tools.listEmailTemplates, { purpose: "rejection" })) as {
      templates: { id: string }[];
    };
    expect(rejections.templates.map((t) => t.id)).toEqual([REJECTION]);

    expect(await execTool(tools.listEmailTemplates, { templateId: "d0000000-0000-4000-8000-0000000000ff" })).toEqual({
      error: "Template not found.",
    });
  });
});

describe("createEmailTemplate tool", () => {
  it("adds the template through the shared helper, as the agent", async () => {
    vi.mocked(createTemplate).mockResolvedValue({
      ok: true,
      template: template({ id: CUSTOM, purpose: "custom", name: "Follow-up", is_default: false }),
    });

    const result = await execTool(tools.createEmailTemplate, {
      purpose: "custom",
      name: " Follow-up ",
      subject: "Hi",
      body: "Hello",
    });

    const [ctx, input, options] = vi.mocked(createTemplate).mock.calls[0];
    expectSessionCtx(ctx);
    expect(input).toEqual({ purpose: "custom", name: "Follow-up", subject: "Hi", body: "Hello" });
    expect(options).toEqual({ source: "agent" });
    expect(result).toEqual({ template: { id: CUSTOM, name: "Follow-up", purpose: "custom" } });
  });

  it("returns the helper's refusal with the unknown variables", async () => {
    vi.mocked(createTemplate).mockResolvedValue({
      ok: false,
      error: "Remove or fix {{salary}}.",
      unknownVariables: ["salary"],
    });

    expect(
      await execTool(tools.createEmailTemplate, { purpose: "offer", name: "Offer", subject: "{{salary}}", body: "Hi" }),
    ).toEqual({ error: "Remove or fix {{salary}}.", unknownVariables: ["salary"] });
  });
});

describe("updateEmailTemplate tool", () => {
  it("saves only the fields given, through the shared helper", async () => {
    vi.mocked(saveTemplate).mockResolvedValue({ ok: true, purpose: "rejection" });

    const result = await execTool(tools.updateEmailTemplate, { templateId: REJECTION, body: "Thanks for applying." });

    const [ctx, input, options] = vi.mocked(saveTemplate).mock.calls[0];
    expectSessionCtx(ctx);
    expect(input).toEqual({ templateId: REJECTION, body: "Thanks for applying." });
    expect(options).toEqual({ source: "agent" });
    expect(result).toEqual({ templateId: REJECTION, updated: true });
  });

  it("returns the helper's refusal", async () => {
    vi.mocked(saveTemplate).mockResolvedValue({ ok: false, error: "Template not found." });

    expect(await execTool(tools.updateEmailTemplate, { templateId: REJECTION, name: "R" })).toEqual({
      error: "Template not found.",
    });
  });
});

describe("deleteEmailTemplate tool", () => {
  it("deletes through the shared helper", async () => {
    vi.mocked(deleteTemplate).mockResolvedValue({ ok: true });

    expect(await execTool(tools.deleteEmailTemplate, { templateId: CUSTOM })).toEqual({
      templateId: CUSTOM,
      deleted: true,
    });
    const [ctx, input] = vi.mocked(deleteTemplate).mock.calls[0];
    expectSessionCtx(ctx);
    expect(input).toEqual({ templateId: CUSTOM });
  });

  it("returns the refusal for a default template", async () => {
    const error = "Template not found, or it's a default template.";
    vi.mocked(deleteTemplate).mockResolvedValue({ ok: false, error });

    expect(await execTool(tools.deleteEmailTemplate, { templateId: REJECTION })).toEqual({ error });
  });
});
