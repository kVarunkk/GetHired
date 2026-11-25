import { describe, expect, it } from "vitest";
import { APPLICANT_STARTERS } from "@/components/agent/roles";
import { followUpPrompt } from "@/helpers/tracker/agent-prompts";
import { trackerItem } from "@/test/utils/tracker";
import { attentionItems } from "./summary";
import { dashboardSuggestions, MAX_SUGGESTIONS } from "./suggestions";

const NOW = new Date("2026-11-25T12:00:00");

describe("dashboardSuggestions", () => {
  it("puts the user's own interview, follow-up and top match before the starters", () => {
    const item = trackerItem({ nextFollowUpAt: "2026-11-25", companyName: "Acme" });
    const suggestions = dashboardSuggestions({
      attention: attentionItems([item], NOW),
      nextInterview: { interviewName: "Tech screen", jobTitle: "Engineer", companyName: "Stripe" },
      topJob: { id: "11111111-1111-4111-8111-111111111111", jobTitle: "Designer", companyName: "Figma" },
    });
    expect(suggestions.map((s) => s.label)).toEqual([
      "Prep for my Stripe interview",
      "Draft a follow-up to Acme",
      "Tailor my resume for Figma",
      APPLICANT_STARTERS[0],
    ]);
    expect(suggestions[1].prompt).toBe(followUpPrompt(item));
    expect(suggestions[2].prompt).toContain("(/jobs/11111111-1111-4111-8111-111111111111)");
  });

  it("falls back to the starters", () => {
    const suggestions = dashboardSuggestions({ attention: [], nextInterview: null, topJob: null });
    expect(suggestions.map((s) => s.prompt)).toEqual(APPLICANT_STARTERS.slice(0, MAX_SUGGESTIONS));
  });
});
