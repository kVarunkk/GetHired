import { describe, expect, it, vi } from "vitest";
import { reportError, toException } from "./report-error";

describe("toException", () => {
  it("uses the first Error and keeps the log line", () => {
    const err = new Error("boom");
    const { error, properties } = toException(["[billing] cancel failed", err]);
    expect(error).toBe(err);
    expect(properties.log_message).toBe("[billing] cancel failed boom");
  });

  it("names a Supabase error after the log prefix, so ids don't split the issue", () => {
    const pgError = { message: "duplicate key", code: "23505" };
    const { error, properties } = toException(["[apply] insert failed", pgError]);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("[apply] insert failed");
    expect(properties.error_details).toBe(pgError);
  });

  it("falls back to the object's message without a prefix", () => {
    expect(toException([{ message: "timeout" }]).error.message).toBe("timeout");
  });
});

describe("reportError", () => {
  it("still logs to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("[x] failed", 42);
    expect(spy).toHaveBeenCalledWith("[x] failed", 42);
  });
});
