import { describe, expect, it } from "vitest";
import { serializeTalent, talentAccepts } from "./talent";
import type { FeedJob } from "./feed-job";

const job: FeedJob = {
  id: "job-1",
  title: "Backend Engineer",
  descriptionHtml: `<p>${"Build and run services. ".repeat(4)}</p>`,
  city: "Bengaluru",
  locations: ["Bengaluru"],
  state: "Karnataka",
  country: "India",
  countryCode: "IN",
  workplace: "remote",
  jobType: "contract",
  companyName: "Acme",
  companyLogoUrl: "https://cdn.example.com/logo",
  companyCity: null,
  companyLogoType: "png",
  salary: { min: 1000000, max: 2000000, currency: "INR", text: null },
  experience: { min: 2, max: 5 },
  category: "Engineering",
  postedAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-10T10:00:00Z"),
};

const squash = (xml: string) => xml.replace(/>\s+</g, "><");

describe("serializeTalent (Talent.com XML guide)", () => {
  it("uses the <source> root, the general attributes and every required job tag", () => {
    const xml = serializeTalent([job], new Date("2026-11-18T00:00:00Z"));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<source>')).toBe(true);
    expect(xml).toContain("<publisher><![CDATA[GetHired]]></publisher>");
    expect(xml).toContain("<lastbuilddate><![CDATA[2026-11-18T00:00:00Z]]></lastbuilddate>");
    for (const t of [
      "<referencenumber><![CDATA[job-1]]></referencenumber>",
      "<title><![CDATA[Backend Engineer]]></title>",
      "<company><![CDATA[Acme]]></company>",
      "<city><![CDATA[Bengaluru]]></city>",
      "<state><![CDATA[Karnataka]]></state>",
      "<country><![CDATA[India]]></country>",
      "<dateposted><![CDATA[2026-11-01T10:00:00Z]]></dateposted>",
    ]) {
      expect(xml).toContain(t);
    }
    expect(xml).toMatch(/<description><!\[CDATA\[<p>Build/);
  });

  it("puts source=talent in the url and writes job type and remote as the guide does", () => {
    const xml = serializeTalent([job]);
    expect(xml).toContain("src=talent");
    expect(xml).toContain("&source=talent");
    expect(xml).toContain("<isremote><![CDATA[yes]]></isremote>");
    expect(xml).toContain("<jobtype><![CDATA[Contract]]></jobtype>");
    expect(serializeTalent([{ ...job, jobType: "full_time" }])).toContain("<jobtype><![CDATA[Full time]]></jobtype>");
  });

  it("nests salary and experience with their period and type", () => {
    const xml = squash(serializeTalent([job]));
    expect(xml).toContain(
      "<salary><salary_max><![CDATA[2000000]]></salary_max><salary_min><![CDATA[1000000]]></salary_min>" +
        "<salary_currency><![CDATA[INR]]></salary_currency><period><![CDATA[year]]></period>" +
        "<type><![CDATA[BASE_SALARY]]></type></salary>",
    );
    expect(xml).toContain(
      "<experience><experience_max><![CDATA[5]]></experience_max><experience_min><![CDATA[2]]></experience_min>" +
        "<period><![CDATA[year]]></period></experience>",
    );
    expect(xml).not.toContain("<salary_period>");
  });

  it("leaves out a salary with no amount or no currency, and an empty experience", () => {
    const none = serializeTalent([{ ...job, salary: { min: null, max: null, currency: "INR", text: "Competitive" } }]);
    expect(none).not.toContain("<salary>");
    expect(serializeTalent([{ ...job, salary: { ...job.salary!, currency: null } }])).not.toContain("<salary>");
    expect(serializeTalent([{ ...job, experience: { min: null, max: null } }])).not.toContain("<experience>");
  });

  it("sends only a PNG logo", () => {
    expect(serializeTalent([job])).toContain("<logo>");
    expect(serializeTalent([{ ...job, companyLogoType: "jpeg" }])).not.toContain("<logo>");
  });

  it("sends a category from their list, and none when nothing fits", () => {
    expect(serializeTalent([job])).toContain("<category><![CDATA[Engineering]]></category>");
    expect(serializeTalent([{ ...job, category: null }])).toContain("<category><![CDATA[IT]]></category>");
    expect(serializeTalent([{ ...job, category: null, title: "Chief of Staff" }])).not.toContain("<category>");
  });

  it("never sends cpc or expirationdate", () => {
    const xml = serializeTalent([job]);
    for (const t of ["cpc", "expirationdate"]) expect(xml).not.toContain(`<${t}>`);
  });

  it("adds Talent Apply's posturl only when it's on", () => {
    expect(serializeTalent([job])).not.toContain("<talent-apply-data>");
    const xml = serializeTalent([job], new Date(), { applyPostUrl: (id) => `https://x/apply?token=t-${id}` });
    expect(xml).toContain(
      "<talent-apply-data><![CDATA[talent-apply-posturl=https%3A%2F%2Fx%2Fapply%3Ftoken%3Dt-job-1]]></talent-apply-data>",
    );
  });
});

describe("talentAccepts", () => {
  it("needs a 50-character description, a city and a state", () => {
    expect(talentAccepts(job)).toBe(true);
    expect(talentAccepts({ ...job, descriptionHtml: "<p>short</p>" })).toBe(false);
    expect(talentAccepts({ ...job, city: "" })).toBe(false);
    expect(talentAccepts({ ...job, state: null })).toBe(false);
    expect(serializeTalent([{ ...job, state: null }])).not.toContain("<job>");
  });

  it("places a remote job with no location at the company's headquarters", () => {
    const remote = { ...job, workplace: "remote" as const, city: "", state: null };
    expect(talentAccepts(remote)).toBe(false);
    const xml = serializeTalent([{ ...remote, companyCity: "Pune" }]);
    expect(xml).toContain("<city><![CDATA[Pune]]></city>");
    expect(xml).toContain("<state><![CDATA[Maharashtra]]></state>");
    expect(talentAccepts({ ...remote, companyCity: "Atlantis" })).toBe(false);
    expect(talentAccepts({ ...remote, workplace: "onsite", companyCity: "Pune" })).toBe(false);
  });
});
