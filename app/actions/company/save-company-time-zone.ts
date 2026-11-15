"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isValidTimeZone } from "@/helpers/companies/time-zone";

/**
 * SERVER ACTION (IVT-024, D21): sets the session company's time zone, used
 * for scheduling defaults. Needs `settings.scheduling`; the RPC checks it and
 * the zone again.
 */
export async function saveCompanyTimeZoneAction({
  timeZone,
}: {
  timeZone: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.scheduling" });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Pick a time zone from the list." };

  const { data, error } = await auth.supabase.rpc("update_company_settings", { p_settings: { time_zone: timeZone } });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    return {
      ok: false,
      error: result?.reason === "invalid_input" ? "Pick a time zone from the list." : "Couldn't save the time zone. Please try again.",
    };
  }
  revalidatePath("/company/settings/scheduling");
  return { ok: true };
}
