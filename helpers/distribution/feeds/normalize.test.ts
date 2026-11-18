import { describe, expect, it } from "vitest";
import { cityOf, talentCategory, cleanFeedTitle, indianState, isoCurrency, logoTypeOf, salaryBound, textToHtml, NO_SALARY_TEXT } from "./normalize";

describe("textToHtml", () => {
  it("keeps paragraphs and line breaks the page shows", () => {
    expect(textToHtml("About us\nWe build things.\n\nThe role")).toBe(
      "<p>About us<br>We build things.</p>\n<p>The role</p>",
    );
  });

  it("turns bullet and numbered runs into lists", () => {
    expect(textToHtml("You will:\n- build APIs\n• run services\n\n1. Apply\n2) Interview")).toBe(
      "<p>You will:</p>\n<ul><li>build APIs</li><li>run services</li></ul>\n<ol><li>Apply</li><li>Interview</li></ol>",
    );
  });

  it("escapes text so it reads as on the page", () => {
    expect(textToHtml("<5 years in R&D <script>")).toBe("<p>&lt;5 years in R&amp;D &lt;script&gt;</p>");
  });

  it("handles Windows line endings and blank input", () => {
    expect(textToHtml("a\r\nb")).toBe("<p>a<br>b</p>");
    expect(textToHtml("  \n ")).toBe("");
  });
});

describe("isoCurrency", () => {
  it.each([
    ["₹", "INR"],
    ["$", "USD"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["C$", "CAD"],
    ["A$", "AUD"],
    ["inr", "INR"],
    ["SGD", "SGD"],
  ])("%s is %s", (input, code) => expect(isoCurrency(input)).toBe(code));

  it("is null for nothing or an unknown symbol", () => {
    expect(isoCurrency(null)).toBeNull();
    expect(isoCurrency("¥¥")).toBeNull();
  });
});

describe("salaryBound and NO_SALARY_TEXT", () => {
  it("treats the form's 0 as not given", () => {
    expect(salaryBound(0)).toBeNull();
    expect(salaryBound(null)).toBeNull();
    expect(salaryBound(1200000)).toBe(1200000);
  });

  it("recognises buildSalaryRange's empty text", () => {
    expect(NO_SALARY_TEXT.test("Not specified")).toBe(true);
    expect(NO_SALARY_TEXT.test("")).toBe(true);
    expect(NO_SALARY_TEXT.test("10 - 20 LPA")).toBe(false);
  });
});

describe("cleanFeedTitle", () => {
  it.each([
    ["Urgent Hiring: Backend Engineer", "Backend Engineer"],
    ["Backend Engineer - Bengaluru", "Backend Engineer"],
    ["Backend Engineer (Remote)", "Backend Engineer"],
    ["Backend Engineer | Remote / Hybrid", "Backend Engineer"],
    ["Backend Engineer in Bengaluru", "Backend Engineer"],
    ["Backend Engineer (₹20-30 LPA)", "Backend Engineer"],
    ["Backend Engineer - Full-time", "Backend Engineer"],
    ["Backend Engineer, Job ID: BE-2041", "Backend Engineer"],
    ["Data Analyst (Immediate Joiners)", "Data Analyst"],
  ])("%s → %s", (input, out) => expect(cleanFeedTitle(input, ["Bengaluru"])).toBe(out));

  it("keeps titles that only look close", () => {
    expect(cleanFeedTitle("Contract Manager", ["Mumbai"])).toBe("Contract Manager");
    expect(cleanFeedTitle("Software Engineer (L2)", [])).toBe("Software Engineer (L2)");
    expect(cleanFeedTitle("Remote Sensing Scientist", [])).toBe("Remote Sensing Scientist");
    expect(cleanFeedTitle("Head of Sales, APAC", ["Mumbai"])).toBe("Head of Sales, APAC");
  });

  it("falls back to the stored title rather than return nothing", () => {
    expect(cleanFeedTitle("Remote", [])).toBe("Remote");
  });
});

describe("logoTypeOf and indianState", () => {
  it("reads the logo type from its Content-Type", () => {
    expect(logoTypeOf("image/png")).toBe("png");
    expect(logoTypeOf("image/jpeg; charset=binary")).toBe("jpeg");
    expect(logoTypeOf("image/webp")).toBe("webp");
    expect(logoTypeOf("text/html")).toBeNull();
  });

  it("finds the state of common Indian cities in any spelling", () => {
    expect(indianState("Bengaluru")).toBe("Karnataka");
    expect(indianState(" bangalore ")).toBe("Karnataka");
    expect(indianState("Gurugram")).toBe("Haryana");
    expect(indianState("Atlantis")).toBeNull();
  });
});

describe("talentCategory and cityOf", () => {
  it.each([
    ["Engineering", "Backend Engineer", "Engineering"],
    [null, "Backend Engineer", "IT"],
    [null, "Senior Software Developer", "IT"],
    ["Sales", "Business Development Executive", "Sales"],
    [null, "Business Development Executive", "Sales"],
    [null, "HR Generalist", "Human Resources"],
    [null, "Staff Nurse", "Nursing"],
    [null, "Chartered Accountant", "Accounting"],
    [null, "Customer Support Associate", "Customer Service"],
    [null, "UI/UX Designer", "Multimedia"],
    [null, "Mechanical Engineer", "Engineering"],
    [null, "Warehouse Associate", "Warehouse"],
    ["Ops", "Chief of Staff", null],
  ])("%s / %s is %s", (department, title, category) => expect(talentCategory(department, title)).toBe(category));

  it("takes the city from a free-text place", () => {
    expect(cityOf("Bengaluru, Karnataka, India")).toBe("Bengaluru");
    expect(cityOf("  ")).toBeNull();
    expect(cityOf(null)).toBeNull();
  });
});
