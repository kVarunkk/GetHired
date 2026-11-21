import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { asksForAnyRole, chatUserText, namesExperienceLevel, pastedByUser } from "./request-intent";

describe("asksForAnyRole", () => {
  it.each([
    "show me any job",
    "jobs of any role in Pune",
    "any remote job is fine",
    "all kinds of jobs in Bengaluru",
    "every type of position",
    "anything remote",
    "whatever's available",
    "regardless of the role",
    "show jobs in other fields",
    "not just my role",
  ])("is true for %j", (text) => {
    expect(asksForAnyRole(text)).toBe(true);
  });

  // Traces 95571a1f and edf8278a: these ask for more of the user's role.
  it.each([
    "Show more remote jobs",
    "show some more jobs",
    "Show me more matching jobs",
    "do you have any more jobs?",
    "are there any other jobs",
    "show all matching jobs",
    "jobs for me",
    "",
  ])("is false for %j", (text) => {
    expect(asksForAnyRole(text)).toBe(false);
  });
});

describe("namesExperienceLevel", () => {
  it.each([
    "show some fresher backend roles",
    "show some senior ones",
    "entry-level jobs",
    "junior react roles",
    "jobs for 3 years experience",
    "internships in Pune",
  ])("is true for %j", (text) => {
    expect(namesExperienceLevel(text)).toBe(true);
  });

  it.each(["show some more jobs", "Find remote AI engineer jobs in India paying over 15 LPA", "jobs from my resume"])(
    "is false for %j",
    (text) => {
      expect(namesExperienceLevel(text)).toBe(false);
    },
  );
});

describe("pastedByUser", () => {
  const JD = "Senior backend engineer. You will design payment services in Go, run Postgres, and mentor engineers.";

  it("counts a description the user pasted, even reformatted", () => {
    expect(pastedByUser(JD, `Tailor my resume to this:\n${JD}`)).toBe(true);
    expect(pastedByUser(JD.toUpperCase().replace(/\. /g, ".\n- "), JD)).toBe(true);
  });

  it("doesn't count one written from a short request", () => {
    expect(pastedByUser(JD, "tailor my resume for backend roles")).toBe(false);
    expect(pastedByUser(JD, "")).toBe(false);
  });
});

describe("chatUserText", () => {
  it("joins every user message's text, and nothing the assistant wrote", () => {
    const history = [
      { id: "1", role: "user", parts: [{ type: "text", text: "first" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "reply" }] },
      { id: "3", role: "user", parts: [{ type: "text", text: "second" }] },
    ] as UIMessage[];

    expect(chatUserText(history)).toBe("first\nsecond");
  });
});
