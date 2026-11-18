import { checkEligibility, type EligibilityInput } from "@/helpers/distribution/eligibility";

/** MP-REQ-001: what the Distribution section shows for one channel of one job. Pure, client-safe. */

export type ChannelKind = "index" | "feed" | "partner_api" | "byo_account";
export type ChannelState = "live" | "queued" | "not_live" | "off" | "pending_approval" | "opted_out" | "error";

export type ChannelRow = {
  key: string;
  name: string;
  kind: ChannelKind;
  state: ChannelState;
  /** Why it isn't live (MP-GUD-002: the cause, never a role name). Empty when live. */
  reasons: string[];
};

type Channel = { key: string; name: string; kind: string; enabled: boolean; requires_approval: boolean };
type Setting = { channel_key: string; enabled: boolean; approved_at: string | null; status: string };
type Posting = { channel_key: string; status: string; reason: string | null };

export const KIND_LABELS: Record<ChannelKind, string> = {
  index: "Search engine",
  feed: "Job feed",
  partner_api: "Partner",
  byo_account: "Your account",
};

export const STATE_LABELS: Record<ChannelState, string> = {
  live: "Live",
  queued: "Queued",
  not_live: "Not live",
  off: "Off",
  pending_approval: "Waiting for the board",
  opted_out: "Opted out",
  error: "Error",
};

export function buildChannelRows({
  channels,
  settings,
  postings,
  jobStatus,
  job,
}: {
  channels: Channel[];
  settings: Setting[];
  postings: Posting[];
  jobStatus: "active" | "inactive";
  job: EligibilityInput;
}): ChannelRow[] {
  const eligibility = checkEligibility(job);
  const settingOf = new Map(settings.map((s) => [s.channel_key, s]));
  const postingOf = new Map(postings.map((p) => [p.channel_key, p]));

  return channels
    .filter((c) => c.enabled)
    .map((c): ChannelRow => {
      const kind = c.kind as ChannelKind;
      const row = (state: ChannelState, reasons: string[] = []): ChannelRow => ({
        key: c.key,
        name: c.name,
        kind,
        state,
        reasons,
      });
      const posting = postingOf.get(c.key);

      // Nothing is distributed by default except `index` (MP-REQ-011).
      if (kind !== "index") {
        const setting = settingOf.get(c.key);
        if (!setting?.enabled) return row("off", ["Not turned on for your company"]);
        if (setting.status === "error") return row("error", ["The channel reported a problem"]);
        if (posting?.status === "opted_out") return row("opted_out", ["Left out for this job"]);
      }

      if (jobStatus !== "active") return row("not_live", ["The job isn't active"]);
      if (!eligibility.eligible) return row("not_live", eligibility.reasons.map((r) => r.message));
      if (posting?.status === "error") return row("error", [posting.reason ?? "The last push failed"]);
      if (kind === "index") return row("live");
      // `requires_approval` is the board's approval of GetHired, set once per
      // channel. Feeds carry the job either way, so the board can review them.
      if (c.requires_approval) {
        return row("pending_approval", [
          kind === "feed" ? `In the feed. ${c.name} hasn't approved GetHired yet` : `${c.name} hasn't approved GetHired yet`,
        ]);
      }
      if (kind === "feed") return row("live");
      if (posting?.status !== "live") return row("queued", ["Waiting for the next push"]);
      return row("live");
    });
}
