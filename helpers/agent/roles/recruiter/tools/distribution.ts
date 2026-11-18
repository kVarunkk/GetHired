import { tool } from "ai";
import { z } from "zod";
import { setChannelEnabled, setJobChannelOptOut } from "@/helpers/distribution/channel-writes";
import { STATE_LABELS } from "@/helpers/distribution/channel-status";
import { loadCompanyChannels, loadJobDistribution } from "@/helpers/distribution/load-job-distribution";
import { jobPostUrl, requireToolPermission, type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

const channelKey = z.string().trim().min(1).max(60);

export const distributionUrl = (jobPostId: string) => `${jobPostUrl(jobPostId)}/distribution`;

/**
 * MP-REQ-012: the agent reads where a job is published and switches feed
 * channels on or off, through the same helpers as the Distribution page
 * (helpers/distribution/channel-writes.ts), so the opt-in rules and the feed
 * rebuild apply unchanged. Writes always ask. Index channels (Google, Bing)
 * are always on, and BYO accounts are set up on the page, not here.
 */
export function createDistributionTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    getDistribution: tool({
      description:
        "Read where jobs are published beyond GetHired. With a jobPostId: each channel's state for that job (live, queued, not live, off, not approved yet, opted out, error) and the reasons it isn't live. Without one: each channel's company-wide switch (on, off, waiting for approval). Channels with 'canToggle' can be changed with setDistribution.",
      inputSchema: z.object({ jobPostId: uuidInput("job post").optional() }).strict(),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getDistribution", async () => {
          if (!jobPostId) {
            return { channels: await loadCompanyChannels(supabase, company.id) };
          }
          const result = await loadJobDistribution(supabase, company.id, jobPostId);
          if (!result) return { error: "Job post not found." };
          const toggleable = new Set(result.channels.filter((c) => c.kind === "feed" || c.kind === "partner_api").map((c) => c.key));
          return {
            job: { title: result.job.title, status: result.job.status, url: distributionUrl(result.job.id) },
            channels: result.rows.map((row) => ({
              key: row.key,
              name: row.name,
              kind: row.kind,
              state: STATE_LABELS[row.state],
              reasons: row.reasons,
              canToggle: toggleable.has(row.key),
            })),
          };
        }),
    }),

    setDistribution: tool({
      description:
        "Change distribution for a feed or partner channel from getDistribution (canToggle). Pass enabled to turn the channel on or off for the whole company (needs access to all jobs; a channel that needs our approval stays 'waiting for approval' until we approve it), or jobPostId with optedOut to leave one job out of it or put it back. Pass one or the other, not both. Takes effect in the channel's next feed build.",
      inputSchema: z
        .object({
          channelKey,
          enabled: z.boolean().optional().describe("Company-wide: true turns the channel on, false off."),
          jobPostId: uuidInput("job post").optional().describe("With optedOut: the job to leave out or put back."),
          optedOut: z.boolean().optional().describe("true leaves the job out of this channel, false puts it back."),
        })
        .strict()
        .refine(
          (input) =>
            (input.enabled !== undefined && input.jobPostId === undefined && input.optedOut === undefined) ||
            (input.enabled === undefined && input.jobPostId !== undefined && input.optedOut !== undefined),
          { message: "Pass either enabled, or jobPostId with optedOut." },
        ),
      execute: (input) =>
        withToolErrors(ctx, "setDistribution", async () => {
          if (input.enabled !== undefined) {
            // A company-wide switch needs scope all, which the per-job check can't see.
            const denied = requireToolPermission(ctx, "distribution.manage", null);
            if (denied) return denied;
            const result = await setChannelEnabled(supabase, company.id, input.channelKey, input.enabled);
            if (!result.ok) return { error: result.error };
            return { channel: input.channelKey, enabled: input.enabled };
          }
          const result = await setJobChannelOptOut(supabase, company.id, input.jobPostId!, input.channelKey, input.optedOut!);
          if (!result.ok) return { error: result.error };
          return {
            channel: input.channelKey,
            optedOut: input.optedOut,
            url: distributionUrl(input.jobPostId!),
          };
        }),
    }),
  };
}
