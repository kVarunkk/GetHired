import { describe, expect, it } from "vitest";
import { canPracticeInterview, followUpPrompt, interviewPrepPrompt, practiceInterviewPrompt, tailorResumePrompt } from "./agent-prompts";
import { trackedApplicationPath } from "./paths";

const linked = { id: "t1", allJobsId: "11111111-1111-4111-8111-111111111111", jobTitle: "Engineer", companyName: "Acme" };
const manual = { ...linked, allJobsId: null };

describe("tracked card agent prompts", () => {
  it("links a GetHired job by its /jobs id", () => {
    expect(tailorResumePrompt(linked)).toBe("Tailor my resume for the Engineer role at Acme (/jobs/11111111-1111-4111-8111-111111111111).");
    expect(practiceInterviewPrompt(linked)).toContain("(/jobs/11111111-1111-4111-8111-111111111111)");
  });

  it("links a job added by hand by its My Jobs page, without its text", () => {
    const prompt = tailorResumePrompt(manual);
    expect(prompt).toBe(`Tailor my resume for the Engineer role at Acme (${trackedApplicationPath("t1")}).`);
    expect(prompt).not.toContain("/jobs/");
  });

  it("offers a practice interview only for GetHired jobs", () => {
    expect(canPracticeInterview(linked)).toBe(true);
    expect(canPracticeInterview(manual)).toBe(false);
  });

  it("drafts a follow-up with the job's link and the day applied", () => {
    expect(followUpPrompt({ ...linked, appliedAt: "2026-11-02" })).toBe(
      "Draft a short, polite follow-up message about my application for the Engineer role at Acme (/jobs/11111111-1111-4111-8111-111111111111). I applied on 2026-11-02.",
    );
  });

  it("preps for an interview by name, role and company", () => {
    expect(interviewPrepPrompt({ interviewName: "Tech screen", jobTitle: "Engineer", companyName: "Acme" })).toBe(
      'Help me prepare for my upcoming "Tech screen" interview for the Engineer role at Acme.',
    );
  });
});
