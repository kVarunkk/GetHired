import { describe, expect, it } from "vitest";
import { domainNotice, emailDomain, isFreeMailDomain } from "./free-mail-domains";

describe("isFreeMailDomain (TMT-032)", () => {
  it("knows the common free-mail domains, case-insensitively", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("Gmail.COM")).toBe(true);
    expect(isFreeMailDomain("outlook.com")).toBe(true);
  });

  it("treats a company domain and nothing as not free mail", () => {
    expect(isFreeMailDomain("acme.com")).toBe(false);
    expect(isFreeMailDomain("")).toBe(false);
    expect(isFreeMailDomain(null)).toBe(false);
  });
});

describe("emailDomain", () => {
  it("lowercases the part after the last @", () => {
    expect(emailDomain(" Priya@Acme.COM ")).toBe("acme.com");
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});

describe("domainNotice (TM-REQ-010)", () => {
  it("warns when the invitee's domain differs from the owner's company domain", () => {
    expect(domainNotice("founder@acme.com", "friend@gmail.com")).toBe(
      "Not an @acme.com address. Make sure you trust this person.",
    );
  });

  it("says nothing for the same domain, in any case", () => {
    expect(domainNotice("founder@acme.com", "eng@ACME.com")).toBeNull();
  });

  it("says nothing when the owner is on free mail", () => {
    expect(domainNotice("founder@gmail.com", "recruiter@agency.io")).toBeNull();
  });

  it("says nothing without an owner email", () => {
    expect(domainNotice(null, "recruiter@agency.io")).toBeNull();
  });
});
