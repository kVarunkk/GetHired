import { describe, expect, it } from "vitest";
import { channelOf, summarizeChannelStats } from "./channel-stats";

const app = (source: string, source_detail: string | null, stage_kind: string | null) => ({ source, source_detail, stage_kind });

describe("channelOf", () => {
  it("is gethired unless the application came from a board", () => {
    expect(channelOf(app("applied", null, null))).toBe("gethired");
    expect(channelOf(app("careers_page", "ref", null))).toBe("gethired");
    expect(channelOf(app("job_board", "jooble", null))).toBe("jooble");
    expect(channelOf(app("job_board", null, null))).toBe("other");
  });
});

describe("summarizeChannelStats", () => {
  it("counts applies and stages per channel, busiest first", () => {
    const stats = summarizeChannelStats([
      app("job_board", "jooble", "applied"),
      app("job_board", "jooble", "interview"),
      app("job_board", "jooble", "hired"),
      app("job_board", "adzuna", "rejected"),
      app("applied", null, "on_hold"),
      app("applied", null, null),
    ]);
    expect(stats).toEqual([
      { channel: "jooble", applies: 3, progressed: 1, hired: 1, rejected: 0 },
      { channel: "gethired", applies: 2, progressed: 0, hired: 0, rejected: 0 },
      { channel: "adzuna", applies: 1, progressed: 0, hired: 0, rejected: 1 },
    ]);
  });
  it("is empty with no applications", () => {
    expect(summarizeChannelStats([])).toEqual([]);
  });
});
