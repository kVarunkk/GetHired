import { describe, expect, it } from "vitest";
import { FORBIDDEN_CANDIDATE_COLUMNS, PUBLIC_APPLICANT } from "./recruiter";
import { CONTACT_COLUMNS, directoryRowOf, outreachOf } from "./outreach";

// Later "no contact fields" tests compare against these fixtures; a fixture
// that already leaked a contact column would let them pass vacuously.
describe("outreach fixtures (ORT-001)", () => {
  it.each([...FORBIDDEN_CANDIDATE_COLUMNS, ...CONTACT_COLUMNS])(
    "directoryRowOf() has no %s",
    (column) => {
      expect(directoryRowOf()).not.toHaveProperty(column);
    },
  );

  it("directoryRowOf() has no embedding column", () => {
    expect(Object.keys(directoryRowOf()).filter((k) => /embedding/.test(k))).toEqual([]);
  });

  it("the applicant fixture it's built from does have contact details", () => {
    expect(PUBLIC_APPLICANT.info.email).toBeTruthy();
  });

  it("outreachOf() expires 30 days after sent_at", () => {
    const o = outreachOf("sent");
    expect(Date.parse(o.expires_at) - Date.parse(o.sent_at)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(o.responded_at).toBeNull();
    expect(outreachOf("interested").responded_at).not.toBeNull();
  });
});
