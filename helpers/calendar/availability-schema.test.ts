import { describe, expect, it } from "vitest";
import { DEFAULT_WORKING_HOURS } from "./config";
import { availabilityDefaults, availabilitySchema } from "./availability-schema";

describe("availabilitySchema (IVT-037)", () => {
  it("accepts the defaults", () => {
    expect(availabilitySchema.safeParse({ timeZone: "Europe/London", workingHours: DEFAULT_WORKING_HOURS }).success).toBe(true);
  });

  it.each([
    [{ timeZone: "Mars/Olympus", workingHours: DEFAULT_WORKING_HOURS }, "Pick a time zone from the list."],
    [{ timeZone: "UTC", workingHours: { mon: { start: "18:00", end: "10:00" } } }, "End after the start."],
    [{ timeZone: "UTC", workingHours: { mon: { start: "9am", end: "10:00" } } }, "Use a time like 09:30."],
    [{ timeZone: "UTC", workingHours: {} }, "Pick at least one working day."],
  ])("refuses %j", (input, message) => {
    const result = availabilitySchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(message);
  });

  it("refuses unknown days and keys", () => {
    expect(availabilitySchema.safeParse({ timeZone: "UTC", workingHours: { someday: { start: "09:00", end: "10:00" } } }).success).toBe(false);
    expect(availabilitySchema.safeParse({ timeZone: "UTC", workingHours: DEFAULT_WORKING_HOURS, userId: "x" }).success).toBe(false);
  });
});

describe("availabilityDefaults (IV-REQ-011)", () => {
  it("prefers what's saved", () => {
    const saved = { time_zone: "Asia/Kolkata", working_hours: { tue: { start: "09:00", end: "12:00" } } };
    expect(availabilityDefaults(saved, { browserZone: "Europe/London", companyZone: "UTC" })).toEqual({
      timeZone: "Asia/Kolkata",
      workingHours: { tue: { start: "09:00", end: "12:00" } },
    });
  });

  it("falls back to Mon–Fri 10–18 in the browser's zone, else the company's, else UTC", () => {
    expect(availabilityDefaults(null, { browserZone: "Europe/London", companyZone: "America/New_York" })).toEqual({
      timeZone: "Europe/London",
      workingHours: DEFAULT_WORKING_HOURS,
    });
    expect(availabilityDefaults(null, { browserZone: null, companyZone: "America/New_York" }).timeZone).toBe(
      "America/New_York",
    );
    expect(availabilityDefaults(null, { browserZone: null, companyZone: null }).timeZone).toBe("UTC");
  });
});
