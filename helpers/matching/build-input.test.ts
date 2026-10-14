import { describe, expect, it } from "vitest";
import {
  APPLICATION,
  CANDIDATE_PROFILE,
  INJECTION_LINE,
  JOB_POST,
  PII,
  RESUME_CONTENT,
} from "@/test/utils/matching";
import { buildMatchInput, buildScreeningInput } from "./build-input";
import { MATCH_JOB_DESCRIPTION_MAX_CHARS } from "./config";

const matchInput = () => buildMatchInput(JOB_POST, CANDIDATE_PROFILE, RESUME_CONTENT);
const screeningInput = () => buildScreeningInput(JOB_POST, APPLICATION, CANDIDATE_PROFILE, RESUME_CONTENT);

/** The text of every `<tag>…</tag>` block. */
function sandboxes(input: string) {
  return [...input.matchAll(/<([a-z_0-9]+)>\n([\s\S]*?)\n<\/\1>/g)].map((m) => ({ tag: m[1], body: m[2] }));
}

/** The input with every sandbox block removed. */
const outsideSandboxes = (input: string) => input.replace(/<([a-z_0-9]+)>\n[\s\S]*?\n<\/\1>/g, "");

describe.each([
  ["buildMatchInput", matchInput],
  ["buildScreeningInput", screeningInput],
])("%s (MT-TEST-002)", (_name, build) => {
  it.each(Object.entries(PII))("contains no %s", (_label, value) => {
    expect(build().toLowerCase()).not.toContain(value.toLowerCase());
  });

  it("sandboxes the resume's experience, skills and projects, and the career goals", () => {
    const blocks = sandboxes(build());
    const body = (tag: string) => blocks.find((b) => b.tag === tag)?.body ?? "";

    expect(body("resume_experience")).toContain("Cut the dashboard's load time by 60%");
    expect(body("resume_skills")).toContain("React, TypeScript, Jest");
    expect(body("resume_projects")).toContain("Open-source design system");
    expect(body("candidate_career_goals")).toContain("Lead a frontend platform team.");
  });

  it("keeps candidate text out of the unsandboxed part", () => {
    const outside = outsideSandboxes(build());

    expect(outside).not.toContain("load time");
    expect(outside).not.toContain("platform team");
    expect(outside).not.toContain(INJECTION_LINE);
  });

  it("only has the injection line inside a sandbox", () => {
    const input = build();

    expect(input).toContain(INJECTION_LINE);
    expect(outsideSandboxes(input)).not.toContain(INJECTION_LINE);
  });

  it("keeps visa_sponsorship_required", () => {
    expect(build()).toMatch(/visa_sponsorship_required"?:\s*false/);
  });

  it("trims the job description", () => {
    const long = { ...JOB_POST, description: "x".repeat(MATCH_JOB_DESCRIPTION_MAX_CHARS + 500) };
    const input =
      build === matchInput
        ? buildMatchInput(long, CANDIDATE_PROFILE, RESUME_CONTENT)
        : buildScreeningInput(long, APPLICATION, CANDIDATE_PROFILE, RESUME_CONTENT);

    expect(input).toContain("x".repeat(MATCH_JOB_DESCRIPTION_MAX_CHARS));
    expect(input).not.toContain("x".repeat(MATCH_JOB_DESCRIPTION_MAX_CHARS + 1));
  });

  it("includes the job's requirements", () => {
    const input = build();

    expect(input).toContain(JOB_POST.title);
    expect(input).toContain("React, TypeScript, Testing, Next.js");
    expect(input).toContain("4–8 years");
  });

  it("removes the candidate's name when it appears in resume text", () => {
    const resume = {
      sections: [{ type: "experience", items: [{ bullets: [{ text: `${PII.name} led the rewrite.` }] }] }],
    };
    const input =
      build === matchInput
        ? buildMatchInput(JOB_POST, CANDIDATE_PROFILE, resume)
        : buildScreeningInput(JOB_POST, APPLICATION, CANDIDATE_PROFILE, resume);

    expect(input).not.toContain(PII.name);
    expect(input).not.toContain("Priya");
    expect(input).toContain("led the rewrite");
  });

  it("works without a resume", () => {
    const input =
      build === matchInput
        ? buildMatchInput(JOB_POST, CANDIDATE_PROFILE, null)
        : buildScreeningInput(JOB_POST, APPLICATION, CANDIDATE_PROFILE, null);

    expect(input).toContain("No resume");
  });
});

describe("buildScreeningInput answers", () => {
  it("pairs each question with its answer, sandboxed", () => {
    const answers = sandboxes(screeningInput()).find((b) => b.tag === "screening_answers")!.body;

    expect(answers).toContain(`Q1: ${JOB_POST.questions[0]}\nA1: Our dashboard took 6s to load`);
    expect(answers).toContain(`Q2: ${JOB_POST.questions[1]}\nA2: I want to work on a product`);
  });

  it("marks an empty answer as missing", () => {
    const answers = sandboxes(screeningInput()).find((b) => b.tag === "screening_answers")!.body;

    expect(answers).toContain(`Q3: ${JOB_POST.questions[2]}\nA3: [missing]`);
  });

  it("marks answers missing when there are fewer answers than questions", () => {
    const input = buildScreeningInput(
      JOB_POST,
      { ...APPLICATION, answers: ["Only one"] },
      CANDIDATE_PROFILE,
      RESUME_CONTENT,
    );

    expect(input).toContain("A2: [missing]");
    expect(input).toContain("A3: [missing]");
  });

  it("scrubs contact details from answers", () => {
    const input = buildScreeningInput(
      JOB_POST,
      { ...APPLICATION, answers: [`Email me at ${PII.email}`, "", ""] },
      CANDIDATE_PROFILE,
      RESUME_CONTENT,
    );

    expect(input).not.toContain(PII.email);
  });

  it("says when the job has no screening questions", () => {
    const input = buildScreeningInput(
      { ...JOB_POST, questions: [] },
      { ...APPLICATION, answers: [] },
      CANDIDATE_PROFILE,
      RESUME_CONTENT,
    );

    expect(input).toContain("No screening questions");
  });
});

describe("buildMatchInput", () => {
  it("has no screening answers", () => {
    expect(matchInput()).not.toContain("screening_answers");
  });
});
