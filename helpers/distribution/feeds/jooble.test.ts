import { describe, expect, it } from "vitest";
import { serializeJooble } from "./jooble";
import type { FeedJob } from "./feed-job";

const job: FeedJob = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Backend Engineer",
  descriptionHtml: "<p>Build APIs & ship ]]> things</p>",
  city: "Bengaluru",
  locations: ["Bengaluru"],
  state: "Karnataka",
  country: "India",
  countryCode: "IN",
  workplace: "onsite",
  jobType: "full_time",
  companyName: "Acme",
  companyLogoUrl: "https://cdn.example.com/logo.png",
  companyCity: null,
  companyLogoType: "png",
  salary: { min: 1000000, max: 2000000, currency: "INR", text: null },
  experience: null,
  category: null,
  postedAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-10T10:00:00Z"),
};

describe("serializeJooble", () => {
  it("builds a well-formed feed with the required tags in CDATA", () => {
    const xml = serializeJooble([job]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<jobs>");
    expect(xml).toContain(`<job id="${job.id}">`);
    expect(xml).toContain("<name><![CDATA[Backend Engineer]]></name>");
    expect(xml).toContain("<region><![CDATA[Bengaluru, India]]></region>");
    expect(serializeJooble([{ ...job, locations: ["Bengaluru", "Pune"] }])).toContain(
      "<region><![CDATA[Bengaluru, Pune, India]]></region>",
    );
    expect(xml).toContain("<company><![CDATA[Acme]]></company>");
    expect(xml).toContain("<jobtype><![CDATA[full-time]]></jobtype>");
    expect(xml).toContain("<company_logo><![CDATA[https://cdn.example.com/logo.png]]></company_logo>");
  });

  it("tags the link and uses DD.MM.YYYY dates", () => {
    const xml = serializeJooble([job]);
    expect(xml).toContain(`/jobs/${job.id}?src=jooble&amp;pid=${job.id}`.replace("&amp;", "&"));
    expect(xml).toContain("<pubdate><![CDATA[01.11.2026]]></pubdate>");
    expect(xml).toContain("<updated><![CDATA[10.11.2026]]></updated>");
  });

  it("refreshes updated on every edit", () => {
    const xml = serializeJooble([{ ...job, updatedAt: new Date("2026-11-15T00:00:00Z") }]);
    expect(xml).toContain("<updated><![CDATA[15.11.2026]]></updated>");
  });

  it("never emits contact or paid tags", () => {
    const xml = serializeJooble([job]);
    for (const tag of ["email", "cpc", "paid", "budget"]) expect(xml).not.toContain(`<${tag}>`);
  });

  it("escapes a CDATA terminator inside the description", () => {
    const xml = serializeJooble([job]);
    expect(xml).not.toContain("things</p>]]></description>".replace("things", "]]> things"));
    expect(xml).toContain("]]]]><![CDATA[>");
  });

  it("writes a salary text with currency and leaves it out when unknown", () => {
    expect(serializeJooble([job])).toContain("<salary><![CDATA[INR 1000000 - 2000000 per year]]></salary>");
    expect(serializeJooble([{ ...job, salary: null }])).not.toContain("<salary>");
  });

  it("uses the country for a remote job", () => {
    const xml = serializeJooble([{ ...job, workplace: "remote", city: "" }]);
    expect(xml).toContain("<region><![CDATA[India]]></region>");
  });

  it("serializes an empty feed", () => {
    expect(serializeJooble([])).toContain("<jobs>\n</jobs>");
  });

  it("sends only JPG, PNG or GIF logos", () => {
    expect(serializeJooble([{ ...job, companyLogoType: "jpeg" }])).toContain("<company_logo>");
    expect(serializeJooble([{ ...job, companyLogoType: "webp" }])).not.toContain("<company_logo>");
    expect(serializeJooble([{ ...job, companyLogoType: null }])).not.toContain("<company_logo>");
  });

  it("falls back to the stored range text when there are no amounts", () => {
    const xml = serializeJooble([{ ...job, salary: { min: null, max: null, currency: null, text: "Competitive" } }]);
    expect(xml).toContain("<salary><![CDATA[Competitive]]></salary>");
  });
});
