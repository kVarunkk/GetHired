import { describe, expect, it } from "vitest";
import { isValidTimeZone, timeZoneOptions } from "./time-zone";

describe("time zones (IVT-024)", () => {
  it.each([
    ["Asia/Kolkata", true],
    ["America/New_York", true],
    ["UTC", true],
    ["Mars/Olympus", false],
    ["", false],
    [42, false],
  ])("%s valid: %s", (zone, valid) => {
    expect(isValidTimeZone(zone)).toBe(valid);
  });

  it("lists the zones, keeping a saved one the runtime doesn't list", () => {
    expect(timeZoneOptions()).toContain("Europe/London");
    expect(timeZoneOptions("Etc/GMT+5")[0]).toBe("Etc/GMT+5");
  });
});
