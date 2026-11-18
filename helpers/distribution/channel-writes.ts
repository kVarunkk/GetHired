import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/utils/types/database.types";

export type ChannelWriteResult = { ok: true } | { ok: false; error: string };

/** Kinds a company can switch on itself. Index channels are always on; BYO accounts need credentials (MPT-033). */
const TOGGLEABLE_KINDS = ["feed", "partner_api"];

const SAVE_FAILED = "Couldn't save the change. Please try again.";

async function loadToggleableChannel(supabase: SupabaseClient<Database>, channelKey: unknown) {
  if (typeof channelKey !== "string") return null;
  const { data } = await supabase
    .from("distribution_channels")
    .select("key, kind, enabled, requires_approval")
    .eq("key", channelKey)
    .maybeSingle();
  if (!data || !data.enabled || !TOGGLEABLE_KINDS.includes(data.kind)) return null;
  return data;
}

/**
 * MP-REQ-011: the company opts in or out of one channel for all its jobs.
 * The caller has already checked `distribution.manage` with scope `all`.
 * Turning a channel on takes effect at the next feed build: there is no
 * per-company approval. Whether the board has approved GetHired is the
 * channel's own `requires_approval`. Shared by the server action and the
 * recruiter agent.
 */
export async function setChannelEnabled(
  supabase: SupabaseClient<Database>,
  companyId: string,
  channelKey: string,
  enabled: boolean,
): Promise<ChannelWriteResult> {
  const channel = await loadToggleableChannel(supabase, channelKey);
  if (!channel) return { ok: false, error: "This channel can't be changed." };

  const service = createServiceRoleClient();
  const { error } = await service.from("company_channel_settings").upsert(
    {
      company_id: companyId,
      channel_key: channel.key,
      enabled,
      status: enabled ? "live" : "off",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,channel_key" },
  );
  if (error) return { ok: false, error: SAVE_FAILED };

  await enqueueFeedRebuild({ reason: "settings_changed" });
  revalidatePath("/company/job-posts", "layout");
  return { ok: true };
}

/**
 * MP-REQ-011: leaves one job out of one channel, or puts it back. The caller
 * has already checked `distribution.manage` on that job. The job must belong
 * to the company.
 */
export async function setJobChannelOptOut(
  supabase: SupabaseClient<Database>,
  companyId: string,
  jobId: string,
  channelKey: string,
  optedOut: boolean,
): Promise<ChannelWriteResult> {
  const channel = await loadToggleableChannel(supabase, channelKey);
  if (!channel) return { ok: false, error: "This channel can't be changed." };

  const { data: job } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job posting not found." };

  const service = createServiceRoleClient();
  const { error } = optedOut
    ? await service
        .from("job_channel_postings")
        .upsert({ job_id: job.id, channel_key: channel.key, status: "opted_out", reason: null }, { onConflict: "job_id,channel_key" })
    : await service
        .from("job_channel_postings")
        .update({ status: "pending", reason: null })
        .eq("job_id", job.id)
        .eq("channel_key", channel.key)
        .eq("status", "opted_out");
  if (error) return { ok: false, error: SAVE_FAILED };

  await enqueueFeedRebuild({ reason: "settings_changed" });
  revalidatePath(`/company/job-posts/${job.id}/distribution`);
  return { ok: true };
}
