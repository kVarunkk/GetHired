import { describe, expect, it } from "vitest";
import { jobUrlDomain, normalizeJobUrl, parseGetHiredJobUrl } from "./job-url";

describe("normalizeJobUrl", () => {
  it("lowercases the host and drops www., the fragment and a trailing slash", () => {
    expect(normalizeJobUrl("https://WWW.Acme.com/careers/123/#apply")).toBe("acme.com/careers/123");
  });

  it("drops tracking params and keeps the ones that name the job", () => {
    expect(
      normalizeJobUrl(
        "https://acme.com/jobs?utm_source=x&utm_campaign=y&gh_src=a&src=b&pid=c&ref=d&source=e&lever-source=f&trk=g&jobId=42",
      ),
    ).toBe("acme.com/jobs?jobId=42");
  });

  it("sorts the params so their order doesn't matter", () => {
    expect(normalizeJobUrl("https://acme.com/a?b=2&a=1")).toBe(normalizeJobUrl("https://acme.com/a?a=1&b=2"));
  });

  it.each([
    ["Greenhouse", "https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc", "boards.greenhouse.io/acme/jobs/4012345"],
    ["Greenhouse embed", "https://acme.com/careers?gh_jid=4012345&gh_src=x", "acme.com/careers?gh_jid=4012345"],
    ["Lever", "https://jobs.lever.co/acme/1b2c3d4e-aaaa/apply?lever-source=LinkedIn", "jobs.lever.co/acme/1b2c3d4e-aaaa/apply"],
    ["Ashby", "https://jobs.ashbyhq.com/acme/5f6e7d8c?utm_source=x", "jobs.ashbyhq.com/acme/5f6e7d8c"],
    ["Workable", "https://apply.workable.com/acme/j/ABC123/", "apply.workable.com/acme/j/ABC123"],
    ["Rippling", "https://ats.rippling.com/acme/jobs/9a8b7c?src=board", "ats.rippling.com/acme/jobs/9a8b7c"],
    ["Wellfound", "https://wellfound.com/jobs/123456-frontend-engineer?ref=feed", "wellfound.com/jobs/123456-frontend-engineer"],
    ["LinkedIn view", "https://www.linkedin.com/jobs/view/3912345678/?trk=public_jobs&refId=abc", "linkedin.com/jobs/view/3912345678"],
    ["LinkedIn search", "https://www.linkedin.com/jobs/search/?currentJobId=3912345678&trk=x", "linkedin.com/jobs/search?currentJobId=3912345678"],
    ["Indeed", "https://in.indeed.com/viewjob?jk=abc123&from=serp&utm_campaign=z", "in.indeed.com/viewjob?from=serp&jk=abc123"],
    ["Lever token", "https://jobs.lever.co/acme/1b2c?for=me&token=t1", "jobs.lever.co/acme/1b2c?for=me&token=t1"],
  ])("%s", (_name, url, key) => {
    expect(normalizeJobUrl(url)).toBe(key);
  });

  it.each([["http://acme.com/jobs/1"], ["not a url"], [""], ["ftp://acme.com/x"], ["https://localhost/x"], [null], [undefined]])(
    "returns null for %s",
    (url) => {
      expect(normalizeJobUrl(url)).toBeNull();
    },
  );
});

describe("parseGetHiredJobUrl", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it.each([
    [`https://gethired.devhub.co.in/jobs/${ID}`],
    [`https://www.gethired.devhub.co.in/jobs/${ID}/?src=x`],
    [`https://gethired.devhub.co.in/careers/acme/jobs/${ID}`],
    [`http://localhost:3000/jobs/${ID}`],
    [`http://localhost:3000/careers/acme/jobs/${ID.toUpperCase()}`],
  ])("reads the job id from %s", (url) => {
    expect(parseGetHiredJobUrl(url)).toBe(ID);
  });

  it.each([
    [`https://evil.test/jobs/${ID}`],
    [`http://gethired.devhub.co.in/jobs/${ID}`],
    ["https://gethired.devhub.co.in/jobs/not-an-id"],
    [`https://gethired.devhub.co.in/my-jobs/${ID}`],
    ["junk"],
    [null],
  ])("returns null for %s", (url) => {
    expect(parseGetHiredJobUrl(url)).toBeNull();
  });
});

describe("jobUrlDomain", () => {
  it("returns the host without www.", () => {
    expect(jobUrlDomain("https://www.Lever.co/acme")).toBe("lever.co");
    expect(jobUrlDomain(null)).toBeNull();
    expect(jobUrlDomain("junk")).toBeNull();
  });
});
