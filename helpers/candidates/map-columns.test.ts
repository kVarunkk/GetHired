import { describe, expect, it } from "vitest";
import {
  applyMapping,
  guessMapping,
  headerHash,
  isProtectedHeader,
  mappingProblem,
  protectedHeaderReason,
  sanitizeMapping,
  savedMappingSchema,
  withTarget,
} from "./map-columns";

describe("guessMapping (BI-REQ-011)", () => {
  it.each([
    ["name", "full_name"],
    ["Full Name", "full_name"],
    ["Candidate name", "full_name"],
    ["E-mail", "email"],
    ["Email Address", "email"],
    ["Phone number", "phone"],
    ["Mobile", "phone"],
    ["City", "location"],
    ["Job title", "current_title"],
    ["Current company", "current_company"],
    ["Years of experience", "experience_years"],
    ["LinkedIn", "linkedin_url"],
    ["LinkedIn URL", "linkedin_url"],
    ["GitHub", "github_url"],
    ["Website", "portfolio_url"],
    ["Key skills", "skills"],
    ["Tags", "tags"],
    ["Comments", "notes"],
    ["CV", "resume_url"],
    ["Stage", "stage"],
    ["Status", "stage"],
    ["First name", "first_name"],
    ["Surname", "last_name"],
    ["  NAME  ", "full_name"],
  ])("%s → %s", (header, target) => {
    expect(guessMapping([header])).toEqual([target]);
  });

  it("ignores headers it doesn't know", () => {
    expect(guessMapping(["Source", "Column 4"])).toEqual(["ignore", "ignore"]);
  });

  it("gives a field to its first column only", () => {
    expect(guessMapping(["Email", "E-mail", "Name"])).toEqual(["email", "ignore", "full_name"]);
  });

  it("never marks a known field's header as protected", () => {
    const headers = ["Name", "Email", "Phone", "Location", "Title", "Company", "Experience", "Skills", "Notes", "Stage"];
    expect(headers.filter(isProtectedHeader)).toEqual([]);
  });
});

describe("protected headers (BI-SEC-005)", () => {
  it.each([
    ["Age", "age"],
    ["DOB", "age"],
    ["Date of birth", "age"],
    ["Gender", "gender"],
    ["Sex", "gender"],
    ["Religion", "religion"],
    ["Marital status", "marital status"],
    ["Caste", "caste"],
    ["Photo", "photo"],
    ["Profile picture", "photo"],
    ["Nationality", "nationality"],
    // Not in the list, caught by screenFairnessText (candidate_filter).
    ["Mother tongue", "native language"],
    ["Disability", "disability"],
  ])("%s is ignored, with the reason", (header, term) => {
    expect(guessMapping([header])).toEqual(["ignore"]);
    expect(protectedHeaderReason(header)).toContain(`Looks like ${term}`);
  });

  it("can't be set to a tag, a note or a field", () => {
    const headers = ["Name", "Gender"];
    const columns = guessMapping(headers);
    expect(withTarget(headers, columns, 1, "tag")).toEqual(["full_name", "ignore"]);
    expect(withTarget(headers, columns, 1, "note")).toEqual(["full_name", "ignore"]);
    expect(withTarget(headers, columns, 1, "notes")).toEqual(["full_name", "ignore"]);
    // Nor through a saved or forged mapping.
    expect(sanitizeMapping(headers, ["full_name", "tag"])).toEqual(["full_name", "ignore"]);
    expect(applyMapping([["Asha", "F"]], headers, ["full_name", "tag"])).toEqual([{ full_name: "Asha" }]);
  });
});

describe("withTarget", () => {
  it("moves a single-use field, and lets several columns be tags or notes", () => {
    const headers = ["Name", "Work email", "Personal email", "Source"];
    let columns = guessMapping(headers);
    expect(columns).toEqual(["full_name", "email", "ignore", "ignore"]);
    columns = withTarget(headers, columns, 2, "email");
    expect(columns).toEqual(["full_name", "ignore", "email", "ignore"]);
    columns = withTarget(headers, withTarget(headers, columns, 1, "tag"), 3, "tag");
    expect(columns).toEqual(["full_name", "tag", "email", "tag"]);
  });
});

describe("mappingProblem", () => {
  it("needs a name column", () => {
    expect(mappingProblem(["email"])).toMatch(/name/);
    expect(mappingProblem(["full_name"])).toBeNull();
    expect(mappingProblem(["first_name", "email"])).toBeNull();
  });
});

describe("headerHash", () => {
  it("is the same in another case or spacing, different in another order", async () => {
    const hash = await headerHash(["Name", "Email"]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await headerHash([" name", "EMAIL "])).toBe(hash);
    expect(await headerHash(["Email", "Name"])).not.toBe(hash);
    expect(await headerHash(["Name", "Email", "Phone"])).not.toBe(hash);
  });
});

describe("applyMapping", () => {
  it("joins first and last name, skipping blanks", () => {
    const headers = ["First", "Last", "Email"];
    const mapping = guessMapping(headers);
    expect(
      applyMapping(
        [
          ["Asha", "Rao", "asha@mail.test"],
          ["Ravi", "", "ravi@mail.test"],
          ["", "Iyer", ""],
        ],
        headers,
        mapping,
      ),
    ).toEqual([
      { full_name: "Asha Rao", email: "asha@mail.test" },
      { full_name: "Ravi", email: "ravi@mail.test" },
      { full_name: "Iyer", email: "" },
    ]);
  });

  it("keeps unmapped columns as tags or notes", () => {
    const headers = ["Name", "Tags", "Source", "Team", "Referred by"];
    const rows = [["Asha", "go", "LinkedIn", "", "Ravi"]];
    expect(applyMapping(rows, headers, ["full_name", "tags", "tag", "tag", "note"])).toEqual([
      { full_name: "Asha", tags: "go, LinkedIn", notes: "Referred by: Ravi" },
    ]);
  });

  it("sets every mapped field, blank or not, and the stage", () => {
    expect(applyMapping([["Asha", " ", "Onsite"]], ["Name", "Phone", "Stage"], ["full_name", "phone", "stage"])).toEqual([
      { full_name: "Asha", phone: "", stage: "Onsite" },
    ]);
  });
});

describe("savedMappingSchema", () => {
  it("accepts a mapping with a stage map and refuses anything else", () => {
    const stage = "90000000-0000-4000-8000-000000000001";
    expect(savedMappingSchema.safeParse({ columns: ["full_name", "stage"], stageMap: { Onsite: stage } }).success).toBe(true);
    expect(savedMappingSchema.safeParse({ columns: ["password"] }).success).toBe(false);
    expect(savedMappingSchema.safeParse({ columns: [], stageMap: { Onsite: "x" } }).success).toBe(false);
    expect(savedMappingSchema.safeParse({ columns: [], extra: 1 }).success).toBe(false);
  });
});

describe("the template CSV (BI-REQ-010)", () => {
  it("maps every column by itself", async () => {
    const { templateCsv } = await import("./import-template");
    const [header] = templateCsv().split("\r\n");
    const headers = header.split(",");
    const mapping = guessMapping(headers);
    expect(mapping).not.toContain("ignore");
    expect(new Set(mapping).size).toBe(headers.length);
  });
});
