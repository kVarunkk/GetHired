import { describe, expect, it } from "vitest";
import { mapOutreachError, outreachLimitError } from "./errors";

const pg = (message: string, code = "P0001") => ({ message, code, details: "", hint: "" });

describe("mapOutreachError (ORT-020)", () => {
  it.each([
    ["ALREADY_OPEN", 409],
    ["NOT_ACCEPTING", 403],
    ["CANDIDATE_LIMIT", 429],
    ["NOT_FOUND", 404],
    ["JOB_NOT_FOUND", 404],
    ["NOT_MEMBER", 403],
    ["INVALID_INPUT", 400],
    ["ALREADY_ANSWERED", 409],
    ["EXPIRED", 410],
  ] as const)("maps %s to %i with user copy", (code, status) => {
    const mapped = mapOutreachError(pg(code));
    expect(mapped.code).toBe(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message).not.toBe(code);
    expect(mapped.message.length).toBeGreaterThan(10);
  });

  it("says a block is 'not found', the same as a missing candidate", () => {
    expect(mapOutreachError(pg("NOT_FOUND")).message).toBe(
      "This candidate isn't available to contact.",
    );
  });

  it("has the 402 upgrade message for the monthly limit", () => {
    expect(outreachLimitError()).toEqual({
      code: "OUTREACH_LIMIT",
      status: 402,
      message: "You've used this month's outreach. Upgrade to send more.",
    });
  });

  it.each([
    ["an unknown P0001 message", pg("something internal: user_info.email")],
    ["another SQLSTATE", pg("ALREADY_OPEN", "23505")],
    ["a plain Error", new Error("connection reset: postgres://secret")],
    ["null", null],
  ])("maps %s to a generic 500 without echoing it", (_, err) => {
    const mapped = mapOutreachError(err);
    expect(mapped).toEqual({
      code: "UNKNOWN",
      status: 500,
      message: "Something went wrong. Try again.",
    });
  });
});
