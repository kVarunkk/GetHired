import { describe, expect, it } from "vitest";
import { serializeZipRecruiter, ziprecruiterAccepts, zipExperience } from "./ziprecruiter";
import type { FeedJob } from "./feed-job";

const job: FeedJob = {
  id: "job-1",
  title: "Backend Engineer",
  descriptionHtml: "<p>Build and run services.</p>",
  city: "Bengaluru",
  locations: ["Bengaluru"],
  state: "Karnataka",
  country: "India",
  countryCode: "IN",
  workplace: "hybrid",
  jobType: "full_time",
  companyName: "Acme",
  companyLogoUrl: "https://cdn.example.com/logo",
  companyCity: null,
  companyLogoType: "png",
  salary: { min: 90000, max: 120000, currency: "USD", text: null },
  experience: { min: 3, max: 5 },
  category: "Engineering",
  postedAt: new Date("2026-11-01T10:00:00.123Z"),
  updatedAt: new Date("2026-11-10T10:00:00Z"),
};

describe("serializeZipRecruiter (ZipRecruiter XML Feed Documentation v1.9)", () => {
  it("uses the <source> root with the metadata fields and every required job tag", () => {
    const xml = serializeZipRecruiter([job], new Date("2026-11-18T00:00:00Z"));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<source>')).toBe(true);
    expect(xml).toContain("<lastBuildDate><![CDATA[Wed, 18 Nov 2026 00:00:00 GMT]]></lastBuildDate>");
    expect(xml).toContain("<publisher><![CDATA[GetHired]]></publisher>");
    for (const t of [
      "<referencenumber><![CDATA[job-1]]></referencenumber>",
      "<title><![CDATA[Backend Engineer]]></title>",
      "<description><![CDATA[<p>Build and run services.</p>]]></description>",
      "<country><![CDATA[IN]]></country>",
      "<city><![CDATA[Bengaluru]]></city>",
      "<state><![CDATA[Karnataka]]></state>",
      "<company><![CDATA[Acme]]></company>",
      "<date><![CDATA[2026-11-01T10:00:00Z]]></date>",
    ]) {
      expect(xml).toContain(t);
    }
    expect(xml.trimEnd().endsWith("</source>")).toBe(true);
  });

  it("delivers candidates by url, tagged with the channel, and never by email", () => {
    const xml = serializeZipRecruiter([job]);
    expect(xml).toContain("<url><![CDATA[https://gethired.devhub.co.in/jobs/job-1?src=ziprecruiter&pid=job-1]]></url>");
    expect(xml).not.toContain("<email>");
  });

  it("writes remote, job type and experience as their lists do", () => {
    const xml = serializeZipRecruiter([job]);
    expect(xml).toContain("<accept_remote><![CDATA[0]]></accept_remote>");
    expect(xml).toContain("<jobtype><![CDATA[Full-Time]]></jobtype>");
    expect(xml).toContain("<experience><![CDATA[mid]]></experience>");
    expect(serializeZipRecruiter([{ ...job, workplace: "remote" }])).toContain("<accept_remote><![CDATA[1]]></accept_remote>");
    expect(serializeZipRecruiter([{ ...job, jobType: "contract" }])).toContain("<jobtype><![CDATA[Contractor]]></jobtype>");
    const intern = serializeZipRecruiter([{ ...job, jobType: "internship" }]);
    expect(intern).toContain("<jobtype><![CDATA[Other]]></jobtype>");
    expect(intern).toContain("<experience><![CDATA[intern]]></experience>");
  });

  it("sends yearly compensation in USD, CAD or AUD only", () => {
    const xml = serializeZipRecruiter([job]);
    expect(xml).toContain("<compensation_interval><![CDATA[Annually]]></compensation_interval>");
    expect(xml).toContain("<compensation_min><![CDATA[90000]]></compensation_min>");
    expect(xml).toContain("<compensation_max><![CDATA[120000]]></compensation_max>");
    expect(xml).toContain("<compensation_currency><![CDATA[USD]]></compensation_currency>");
    for (const salary of [
      { ...job.salary!, currency: "INR" },
      { ...job.salary!, currency: null },
      { min: null, max: null, currency: "USD", text: "Competitive" },
    ]) {
      expect(serializeZipRecruiter([{ ...job, salary }])).not.toContain("<compensation_");
    }
  });

  it("keeps compensation_min at or below compensation_max", () => {
    const xml = serializeZipRecruiter([{ ...job, salary: { min: 120000, max: 90000, currency: "CAD", text: null } }]);
    expect(xml).toContain("<compensation_min><![CDATA[90000]]></compensation_min>");
    expect(xml).toContain("<compensation_max><![CDATA[120000]]></compensation_max>");
  });

  it("never sends screening questions, partner attributes, benefits or a logo", () => {
    const xml = serializeZipRecruiter([job]);
    for (const t of ["interview_json", "interview_url", "partner_attributes", "benefits", "logo"]) {
      expect(xml).not.toContain(`<${t}>`);
    }
  });
});

describe("ziprecruiterAccepts", () => {
  it("needs a description, a city with its state, and a reference of at most 64 characters", () => {
    expect(ziprecruiterAccepts(job)).toBe(true);
    expect(ziprecruiterAccepts({ ...job, descriptionHtml: "<p> </p>" })).toBe(false);
    expect(ziprecruiterAccepts({ ...job, state: null })).toBe(false);
    expect(ziprecruiterAccepts({ ...job, id: "x".repeat(65) })).toBe(false);
    expect(serializeZipRecruiter([{ ...job, state: null }])).not.toContain("<job>");
  });

  it("places a remote job with no location at the company's headquarters", () => {
    const remote = { ...job, workplace: "remote" as const, city: "", state: null };
    expect(ziprecruiterAccepts(remote)).toBe(false);
    const xml = serializeZipRecruiter([{ ...remote, companyCity: "Pune" }]);
    expect(xml).toContain("<city><![CDATA[Pune]]></city>");
    expect(xml).toContain("<state><![CDATA[Maharashtra]]></state>");
  });
});

describe("zipExperience", () => {
  it("maps years to their levels", () => {
    const at = (min: number | null, max: number | null = null) =>
      zipExperience({ jobType: "full_time", experience: { min, max } });
    expect(at(0)).toBe("entry");
    expect(at(2)).toBe("entry");
    expect(at(3)).toBe("mid");
    expect(at(6)).toBe("mid");
    expect(at(7)).toBe("senior");
    expect(at(null, 4)).toBe("mid");
    expect(at(null)).toBeNull();
    expect(zipExperience({ jobType: "full_time", experience: null })).toBeNull();
  });
});
