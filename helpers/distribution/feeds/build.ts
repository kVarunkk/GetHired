import { serializeAdzuna } from "./adzuna";
import type { FeedJob } from "./feed-job";
import { serializeJooble } from "./jooble";
import { serializeTalent } from "./talent";
import { serializeZipRecruiter } from "./ziprecruiter";

/** MP-REQ-004: one serializer per feed platform. Pure. */

export const FEED_PLATFORMS = ["jooble", "adzuna", "talent", "ziprecruiter"] as const;
export type FeedPlatform = (typeof FEED_PLATFORMS)[number];

export const isFeedPlatform = (value: string): value is FeedPlatform =>
  (FEED_PLATFORMS as readonly string[]).includes(value);

export type BuildFeedOptions = {
  /** Talent Apply's per-job `posturl` (`talentApplyPostUrl`); Talent Apply is off without it. */
  talentApplyPostUrl?: (jobId: string) => string;
};

export function buildFeed(
  platform: FeedPlatform,
  jobs: FeedJob[],
  builtAt: Date = new Date(),
  options: BuildFeedOptions = {},
): string {
  switch (platform) {
    case "jooble":
      return serializeJooble(jobs);
    case "adzuna":
      return serializeAdzuna(jobs);
    case "talent":
      return serializeTalent(jobs, builtAt, { applyPostUrl: options.talentApplyPostUrl });
    case "ziprecruiter":
      return serializeZipRecruiter(jobs, builtAt);
  }
}
