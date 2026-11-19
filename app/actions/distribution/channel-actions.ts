"use server";

import { isUuid } from "@/helpers/agent/auth";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { setChannelEnabled, setJobChannelOptOut } from "@/helpers/distribution/channel-writes";

type Result = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION (MP-REQ-011): the company opts in or out of one channel for
 * all its jobs. Needs `distribution.manage` with scope `all`. Nothing is
 * distributed until a company opts in; then its jobs go into the feed at
 * the next build.
 */
export async function setChannelEnabledAction({
  channelKey,
  enabled,
}: {
  channelKey: string;
  enabled: boolean;
}): Promise<Result> {
  const auth = await requireCompanyForAction({ permission: "distribution.manage", jobId: null });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (typeof enabled !== "boolean") return { ok: false, error: "Invalid request." };
  return setChannelEnabled(auth.supabase, auth.company.id, channelKey, enabled);
}

/**
 * SERVER ACTION (MP-REQ-011): leaves one job out of one channel, or puts it
 * back. Needs `distribution.manage` on that job. The next feed build drops
 * or restores it.
 */
export async function setJobChannelOptOutAction({
  jobId,
  channelKey,
  optedOut,
}: {
  jobId: string;
  channelKey: string;
  optedOut: boolean;
}): Promise<Result> {
  if (typeof jobId !== "string" || !isUuid(jobId) || typeof optedOut !== "boolean") {
    return { ok: false, error: "Invalid request." };
  }
  const auth = await requireCompanyForAction({ permission: "distribution.manage", jobId });
  if (!auth.ok) return { ok: false, error: auth.error };
  return setJobChannelOptOut(auth.supabase, auth.company.id, jobId, channelKey, optedOut);
}
