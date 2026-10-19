import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_SUBJECT,
  TEMPLATE_VARIABLES,
  purposeForMove,
  renderTemplate,
  type TemplateVars,
} from "./templates";

const VARS: TemplateVars = {
  candidate_first_name: "Priya",
  job_title: "Backend Engineer",
  company_name: "Acme",
  scheduling_link: "https://cal.com/acme/intro",
  sender_name: "Asha",
};

const render = (subject: string, body_md: string, vars: TemplateVars = VARS) =>
  renderTemplate({ subject, body_md }, vars);

describe("renderTemplate (PLT-060, PL-TEST-003)", () => {
  it("substitutes the five whitelisted variables, with or without spaces in the braces", () => {
    expect(TEMPLATE_VARIABLES).toEqual([
      "candidate_first_name",
      "job_title",
      "company_name",
      "scheduling_link",
      "sender_name",
    ]);

    const result = render(
      "{{job_title}} at {{ company_name }}",
      "Hi {{candidate_first_name}}, book here: {{  scheduling_link }}\n\n{{sender_name}}",
    );

    expect(result).toEqual({
      ok: true,
      subject: "Backend Engineer at Acme",
      body: "Hi Priya, book here: <https://cal.com/acme/intro>\n\nAsha",
      unknownVariables: [],
      missingVariables: [],
    });
  });

  it("leaves an unknown variable visible and reports it once", () => {
    const result = render("Hello {{foo}}", "{{foo}} and {{ foo }} and {{bar}}");

    expect(result).toMatchObject({
      ok: true,
      subject: "Hello {{foo}}",
      body: "{{foo}} and {{ foo }} and {{bar}}",
      unknownVariables: ["foo", "bar"],
    });
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "treats {{%s}} as unknown",
    (name) => {
      const result = render("x", `{{${name}}}`);

      expect(result).toMatchObject({ ok: true, body: `{{${name}}}`, unknownVariables: [name] });
    },
  );

  it("reports a missing known variable and leaves it visible", () => {
    const result = render("x", "Pick a time: {{scheduling_link}}", { ...VARS, scheduling_link: null });

    expect(result).toMatchObject({
      ok: true,
      body: "Pick a time: {{scheduling_link}}",
      missingVariables: ["scheduling_link"],
      unknownVariables: [],
    });
  });

  it("inserts a value once, literally, with no second substitution pass", () => {
    const result = render("{{candidate_first_name}}", "Hi {{candidate_first_name}}", {
      ...VARS,
      candidate_first_name: "{{job_title}}",
    });

    expect(result).toMatchObject({ ok: true, subject: "{{job_title}}" });
    // In the markdown body the braces are escaped, so they render as text.
    expect(result.ok && result.body).toBe("Hi \\{\\{job\\_title\\}\\}");
  });

  it("escapes markdown and HTML in values inserted into the body", () => {
    const result = render("x", "Hi {{candidate_first_name}}", {
      ...VARS,
      candidate_first_name: "<script>alert(1)</script> [click](https://evil.test) **bold**",
    });

    expect(result.ok && result.body).toBe(
      "Hi \\<script\\>alert\\(1\\)\\</script\\> \\[click\\]\\(https://evil\\.test\\) \\*\\*bold\\*\\*",
    );
  });

  it("inserts anything but a plain https scheduling link as text", () => {
    const result = render("x", "{{scheduling_link}}", {
      ...VARS,
      scheduling_link: "javascript:alert(1)",
    });

    expect(result.ok && result.body).toBe("javascript:alert\\(1\\)");
  });

  it("strips line breaks from values in the subject", () => {
    const result = render("Hi {{candidate_first_name}}", "x", {
      ...VARS,
      candidate_first_name: "Priya\r\nBcc: someone@evil.test",
    });

    expect(result).toMatchObject({ ok: true, subject: "Hi Priya Bcc: someone@evil.test" });
  });

  it("refuses a subject over 150 chars after rendering", () => {
    const result = render("{{job_title}}", "x", { ...VARS, job_title: "x".repeat(MAX_TEMPLATE_SUBJECT + 1) });

    expect(result).toEqual({ ok: false, error: "The subject is over 150 characters." });
  });

  it("refuses a body over 5,000 chars after rendering", () => {
    const result = render("x", "y".repeat(MAX_TEMPLATE_BODY - 3) + "{{job_title}}");

    expect(result).toEqual({ ok: false, error: "The message is over 5,000 characters." });
  });

  it("refuses an empty subject or body", () => {
    expect(render("  ", "x")).toEqual({ ok: false, error: "Add a subject." });
    expect(render("x", "  ")).toEqual({ ok: false, error: "Add a message." });
  });
});

describe("purposeForMove", () => {
  it.each([
    [null, "applied", "advance"],
    ["applied", "screening", "advance"],
    ["screening", "interview", "interview_invite"],
    ["interview", "offer", "offer"],
    ["offer", "hired", "advance"],
    ["screening", "rejected", "rejection"],
    ["hired", "rejected", "rejection"],
    ["interview", "on_hold", "on_hold"],
    ["rejected", "on_hold", "on_hold"],
    ["rejected", "screening", "reopen"],
    ["rejected", "interview", "reopen"],
    ["hired", "offer", "reopen"],
    ["on_hold", "screening", "reopen"],
    ["on_hold", "interview", "interview_invite"],
    ["on_hold", "offer", "offer"],
    ["interview", "applied", "reopen"],
    ["offer", "screening", "reopen"],
  ])("%s → %s suggests %s", (from, to, purpose) => {
    expect(purposeForMove(from, to)).toBe(purpose);
  });
});
