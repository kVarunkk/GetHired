import { describe, expect, it } from "vitest";
import { badgeTime, meetingBadges } from "./board-badge";

describe("board interview badges (IVT-073)", () => {
  it('formats the next interview as "Tue 14:00" in the given zone', () => {
    expect(badgeTime("2026-10-20T14:00:00.000Z", "UTC")).toBe("Tue 14:00");
    expect(badgeTime("2026-10-20T14:00:00.000Z", "Asia/Kolkata")).toBe("Tue 19:30");
  });

  it("labels the time, then the feedback still owed", () => {
    expect(meetingBadges({ nextAt: "2026-10-20T14:00:00.000Z", feedback: null }, "UTC")).toEqual(["Interview Tue 14:00"]);
    expect(meetingBadges({ nextAt: null, feedback: { submitted: 1, total: 3 } }, "UTC")).toEqual(["Feedback 1/3"]);
    expect(meetingBadges({ nextAt: "2026-10-20T14:00:00.000Z", feedback: { submitted: 0, total: 2 } }, "UTC")).toEqual([
      "Interview Tue 14:00",
      "Feedback 0/2",
    ]);
  });
});
