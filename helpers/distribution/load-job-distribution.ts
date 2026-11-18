import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChannelRows, type ChannelRow } from "@/helpers/distribution/channel-status";
import { jobPageUrl } from "@/helpers/distribution/index-ping";
import type { Database } from "@/utils/types/database.types";

type Channel = { key: string; name: string; kind: string; enabled: boolean; requires_approval: boolean };

export type JobDistribution = {
  job: { id: string; title: string; status: "active" | "inactive" };
  channels: Channel[];
  rows: ChannelRow[];
};

/**
 * MP-REQ-001: a job's channels with their state and reasons, read with the
 * caller's client (RLS applies). Scoped to the company: another company's job
 * is null. Shared by the Distribution page and the recruiter agent.
 */
export async function loadJobDistribution(
  supabase: SupabaseClient<Database>,
  companyId: string,
  jobId: string,
): Promise<JobDistribution | null> {
  const { data: job, error } = await supabase
    .from("job_postings")
    .select("id, job_id, title, description, location, workplace_type, status")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;

  const [channels, settings, postings, info] = await Promise.all([
    supabase.from("distribution_channels").select("key, name, kind, enabled, requires_approval").order("name"),
    supabase.from("company_channel_settings").select("channel_key, enabled, approved_at, status").eq("company_id", companyId),
    supabase.from("job_channel_postings").select("channel_key, status, reason").eq("job_id", job.id),
    supabase.from("company_info").select("name, logo_url").eq("id", companyId).maybeSingle(),
  ]);
  for (const result of [channels, settings, postings, info]) if (result.error) throw result.error;

  const rows = buildChannelRows({
    channels: channels.data ?? [],
    settings: settings.data ?? [],
    postings: postings.data ?? [],
    jobStatus: job.status,
    job: {
      title: job.title,
      description: job.description,
      locations: job.location,
      remote: job.workplace_type === "remote",
      applyUrl: job.job_id ? jobPageUrl(job.job_id) : null,
      companyName: info.data?.name,
      companyLogoUrl: info.data?.logo_url,
    },
  });
  return { job: { id: job.id, title: job.title, status: job.status }, channels: channels.data ?? [], rows };
}

export type CompanyChannelState = "always_on" | "off" | "waiting_for_approval" | "error" | "on";

export type CompanyChannel = {
  key: string;
  name: string;
  kind: string;
  state: CompanyChannelState;
  /** Feed and partner channels: the company turns them on or off in Settings → Distribution. */
  canToggle: boolean;
};

/** The company-wide switch of each channel: Settings → Distribution, and the agent's question with no job. */
export async function loadCompanyChannels(supabase: SupabaseClient<Database>, companyId: string): Promise<CompanyChannel[]> {
  const [channels, settings] = await Promise.all([
    supabase.from("distribution_channels").select("key, name, kind, enabled, requires_approval").order("name"),
    supabase.from("company_channel_settings").select("channel_key, enabled, approved_at, status").eq("company_id", companyId),
  ]);
  for (const result of [channels, settings]) if (result.error) throw result.error;
  const settingOf = new Map((settings.data ?? []).map((s) => [s.channel_key, s]));
  return (channels.data ?? [])
    .filter((c) => c.enabled)
    .map((c): CompanyChannel => {
      const setting = settingOf.get(c.key);
      const always = c.kind === "index";
      return {
        key: c.key,
        name: c.name,
        kind: c.kind,
        state: always
          ? "always_on"
          : !setting?.enabled
            ? "off"
            : c.requires_approval
              ? "waiting_for_approval"
              : setting.status === "error"
                ? "error"
                : "on",
        canToggle: c.kind === "feed" || c.kind === "partner_api",
      };
    });
}
