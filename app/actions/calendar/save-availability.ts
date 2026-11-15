"use server";

import { revalidatePath } from "next/cache";
import { availabilitySchema, type AvailabilityInput } from "@/helpers/calendar/availability-schema";
import { MY_CALENDAR_PATH } from "@/helpers/calendar/config";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

/**
 * SERVER ACTION (IVT-037, IV-REQ-011): the session member's own working hours
 * and time zone. Any member may: they're their own. Written through RLS
 * (member_availability: own row, own company), which checks the shape again.
 */
export async function saveMyAvailabilityAction(
  input: AvailabilityInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await auth.supabase.from("member_availability").upsert(
    {
      user_id: auth.user.id,
      company_id: auth.company.id,
      time_zone: parsed.data.timeZone,
      working_hours: parsed.data.workingHours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,company_id" },
  );
  if (error) return { ok: false, error: "Couldn't save your working hours. Please try again." };
  revalidatePath(MY_CALENDAR_PATH);
  return { ok: true };
}
