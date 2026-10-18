import { describe, expect, it } from "vitest";
import { CANDIDATE_PROFILE, PII } from "@/test/utils/matching";
import { screenFairnessText, scrubPII, stripProtected } from "./fairness";

describe("stripProtected (MT-SEC-002)", () => {
  it.each([
    "full_name",
    "email",
    "phone",
    "linkedin_url",
    "github_url",
    "avatar_url",
    "date_of_birth",
    "gender",
    "marital_status",
    "religion",
    "caste",
    "nationality",
  ])("removes %s", (key) => {
    expect(CANDIDATE_PROFILE).toHaveProperty(key);
    expect(stripProtected(CANDIDATE_PROFILE)).not.toHaveProperty(key);
  });

  it("leaves none of the fixture's PII anywhere in the result", () => {
    const text = JSON.stringify(stripProtected(CANDIDATE_PROFILE));
    for (const value of Object.values(PII)) expect(text).not.toContain(value);
  });

  it("keeps visa_sponsorship_required and the job-relevant fields", () => {
    const stripped = stripProtected(CANDIDATE_PROFILE);

    expect(stripped.visa_sponsorship_required).toBe(false);
    expect(stripped.top_skills).toEqual(CANDIDATE_PROFILE.top_skills);
    expect(stripped.experience_years).toBe(5);
    expect(stripped.preferred_locations).toEqual(CANDIDATE_PROFILE.preferred_locations);
    expect(stripped.desired_roles).toEqual(CANDIDATE_PROFILE.desired_roles);
    expect(stripped.career_goals_short_term).toBe(CANDIDATE_PROFILE.career_goals_short_term);
  });

  it.each([
    "contact_email",
    "workEmail",
    "phone_number",
    "mobile",
    "dob",
    "dob_iso",
    "gender_identity",
    "age",
    "candidate_age",
    "photo",
    "profile_image",
    "twitter_handle",
    "portfolio_url",
    "personal_website",
    "preferred_name",
    "ethnicity",
    "sexual_orientation",
    "birth_place",
  ])("also drops an unknown key like %s", (key) => {
    expect(stripProtected({ [key]: "x", top_skills: ["React"] })).toEqual({ top_skills: ["React"] });
  });

  it.each(["work_style_preferences", "job_type", "salary_currency", "industry_preferences", "languages"])(
    "doesn't drop %s by accident",
    (key) => {
      expect(stripProtected({ [key]: "x" })).toEqual({ [key]: "x" });
    },
  );

  it("doesn't change its input", () => {
    const input = { email: "a@b.co", top_skills: ["Go"] };
    stripProtected(input);
    expect(input).toEqual({ email: "a@b.co", top_skills: ["Go"] });
  });
});

describe("scrubPII (MT-SEC-002)", () => {
  it.each([
    ["an email", "Mail priya@example.com today", "Mail [removed] today"],
    ["an email with a plus and subdomain", "x.y+jobs@mail.co.in", "[removed]"],
    ["an https URL", "See https://priya.dev/portfolio.", "See [removed]."],
    ["a www URL", "Site: www.priya.dev/about", "Site: [removed]"],
    ["a bare profile link", "linkedin.com/in/priya-r", "[removed]"],
    ["an Indian mobile with spaces", "Call +91 98765 43210", "Call [removed]"],
    ["an Indian mobile with dashes", "Call 098765-43210 now", "Call [removed] now"],
    ["a plain 10-digit mobile", "9876543210", "[removed]"],
    ["a US number", "Phone: +1 (415) 555-0134", "Phone: [removed]"],
    ["a UK number", "+44 20 7946 0958", "[removed]"],
  ])("replaces %s", (_label, input, expected) => {
    expect(scrubPII(input)).toBe(expected);
  });

  it.each([
    "5 years of React",
    "2019–2023",
    "2019 - 2023",
    "Cut load time by 60% across 3 teams",
    "1.2k GitHub stars",
    "Node.js and Next.js",
    "Raised ₹15,00,000 in 2021",
    "v2.3.1 released",
    "B.Tech, IIT Bombay",
    "M.Tech in Computer Science",
  ])("leaves %j alone", (input) => {
    expect(scrubPII(input)).toBe(input);
  });

  it("scrubs every contact detail in a resume line", () => {
    const line = `Reach me at ${PII.resumeEmail} or ${PII.resumePhone}, portfolio ${PII.resumeUrl}`;
    const scrubbed = scrubPII(line);

    for (const value of [PII.resumeEmail, PII.resumePhone, PII.resumeUrl]) {
      expect(scrubbed).not.toContain(value);
    }
    expect(scrubbed).toBe("Reach me at [removed] or [removed], portfolio [removed]");
  });
});

describe("screenFairnessText (RA-TEST-006)", () => {
  it.each([
    "freshers only under 25",
    "candidates aged 22-28",
    "below 30 years old",
    "young and energetic",
    "male candidates",
    "Female only",
    "women",
    "unmarried",
    "no kids",
    "not pregnant",
    "Hindu",
    "muslim candidates",
    "Brahmin",
    "upper caste",
    "SC/ST",
    "no disabled people",
    "able-bodied",
    "graduated in 2020",
    "2022 batch",
    "class of 2019",
    "nationality: Indian",
    "with a photo",
    "fair complexion",
    "gay",
    "Caucasian",
    "ladki chahiye",
    "jaati",
    "native English speaker",
    "Native speakers of Hindi",
    "mother tongue Kannada",
    "neutral accent",
    "no strong accents",
  ])("rejects %j", (text) => {
    expect(screenFairnessText(text, { context: "candidate_filter" }).ok).toBe(false);
  });

  it.each([
    "Java",
    "senior",
    "Go",
    "React Native",
    "5+ years of experience",
    "over 20 years of experience",
    "under 30 LPA",
    "fresher",
    "Bachelor's in Computer Science",
    "single page apps",
    "race conditions",
    "black-box testing",
    "white-label products",
    "whiteboard interviews",
    "Engineering Manager",
    "Bengaluru",
    "work authorization in India",
    "image processing",
    "managed a team of 6",
    "React Native and native mobile apps",
    "accent colour",
    "fluent in English",
  ])("allows %j", (text) => {
    expect(screenFairnessText(text, { context: "candidate_filter" })).toEqual({ ok: true });
  });

  it("normalises case and spacing", () => {
    expect(screenFairnessText("  FEMALE   ONLY ", { context: "candidate_filter" }).ok).toBe(false);
    expect(screenFairnessText("Upper	Caste", { context: "candidate_filter" }).ok).toBe(false);
  });

  it("returns the term it matched", () => {
    expect(screenFairnessText("hire young people", { context: "candidate_filter" })).toEqual({
      ok: false,
      term: "young",
    });
  });

  it("allows company descriptions in job posts but not exclusionary requirements", () => {
    expect(
      screenFairnessText("We are a female-founded company", { context: "job_post" }),
    ).toEqual({ ok: true });
    expect(
      screenFairnessText("We are a female-founded company", { context: "candidate_filter" }).ok,
    ).toBe(false);
    expect(screenFairnessText("Women only", { context: "job_post" }).ok).toBe(false);
    expect(screenFairnessText("Age below 30", { context: "job_post" }).ok).toBe(false);
  });
});
