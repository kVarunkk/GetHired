import { describe, expect, it } from "vitest";
import { adzunaCategory, serializeAdzuna } from "./adzuna";
import type { FeedJob } from "./feed-job";

const job: FeedJob = {
  id: "job-1",
  title: "Backend Engineer",
  descriptionHtml: `<p>${"Build and run services. ".repeat(6)}</p>`,
  city: "Bengaluru",
  locations: ["Bengaluru"],
  state: "Karnataka",
  country: "India",
  countryCode: "IN",
  workplace: "onsite",
  jobType: "full_time",
  companyName: "Acme",
  companyLogoUrl: null,
  companyCity: null,
  companyLogoType: null,
  salary: { min: 1000000, max: 2000000, currency: "INR", text: null },
  experience: null,
  category: "Engineering",
  postedAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-10T10:00:00Z"),
};

describe("serializeAdzuna", () => {
  it("emits the mandatory tags with country IN", () => {
    const xml = serializeAdzuna([job]);
    expect(xml).toContain("<jobs>");
    expect(xml).toContain("<id><![CDATA[job-1]]></id>");
    expect(xml).toContain("<title><![CDATA[Backend Engineer]]></title>");
    expect(xml).toContain("<location><![CDATA[Bengaluru]]></location>");
    expect(xml).toContain("<country><![CDATA[IN]]></country>");
    expect(xml).toContain("src=adzuna");
  });

  it("writes salary fields, category id, contract and remote", () => {
    const xml = serializeAdzuna([job]);
    expect(xml).toContain("<salary_min><![CDATA[1000000]]></salary_min>");
    expect(xml).toContain("<salary_max><![CDATA[2000000]]></salary_max>");
    expect(xml).toContain("<salary_frequency><![CDATA[year]]></salary_frequency>");
    expect(xml).toContain("<salary_currency><![CDATA[INR]]></salary_currency>");
    expect(xml).toContain("<category><![CDATA[5]]></category>");
    expect(xml).toContain("<contract_time><![CDATA[full_time]]></contract_time>");
    expect(xml).toContain("<remote><![CDATA[0]]></remote>");
  });

  it("uses the country name as location for a remote job", () => {
    const xml = serializeAdzuna([{ ...job, workplace: "remote" }]);
    expect(xml).toContain("<location><![CDATA[India]]></location>");
    expect(xml).toContain("<remote><![CDATA[1]]></remote>");
  });

  it("leaves out a job outside a supported country or with a thin description", () => {
    expect(serializeAdzuna([{ ...job, countryCode: "JP" }])).not.toContain("<job>");
    expect(serializeAdzuna([{ ...job, descriptionHtml: "<p>short</p>" }])).not.toContain("<job>");
  });

  it("never emits paid tags", () => {
    expect(serializeAdzuna([job])).not.toContain("<cpc>");
  });
});

describe("adzunaCategory", () => {
  it("maps known labels and falls back to Other (29)", () => {
    expect(adzunaCategory("Software")).toBe(2);
    expect(adzunaCategory("Finance")).toBe(1);
    expect(adzunaCategory("Sales")).toBe(3);
    expect(adzunaCategory("Underwater basket weaving")).toBe(29);
    expect(adzunaCategory(null)).toBe(29);
  });

  it("falls back to the title, then Graduate Jobs for an internship", () => {
    expect(adzunaCategory(null, "Backend Engineer")).toBe(2);
    expect(adzunaCategory(null, "Mechanical Engineer")).toBe(5);
    expect(adzunaCategory("Ops", "IT Support Engineer")).toBe(2);
    expect(adzunaCategory(null, "Chief of Staff", "internship")).toBe(16);
    expect(adzunaCategory(null, "Chief of Staff", "full_time")).toBe(29);
  });
});

describe("serializeAdzuna: contract and salary (MPT-027)", () => {
  it("sends internships and contracts as contract, full-time as permanent", () => {
    expect(serializeAdzuna([job])).toContain("<contract_type><![CDATA[permanent]]></contract_type>");
    expect(serializeAdzuna([{ ...job, jobType: "internship" }])).toContain("<contract_type><![CDATA[contract]]></contract_type>");
    expect(serializeAdzuna([{ ...job, jobType: "contract" }])).toContain("<contract_type><![CDATA[contract]]></contract_type>");
  });

  it("writes the salary text and leaves out amounts that aren't there", () => {
    expect(serializeAdzuna([job])).toContain("<salary><![CDATA[INR 1000000 - 2000000 per year]]></salary>");
    const none = serializeAdzuna([{ ...job, salary: null }]);
    for (const t of ["salary", "salary_min", "salary_currency", "salary_frequency"]) expect(none).not.toContain(`<${t}>`);
  });
});
