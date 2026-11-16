import { z } from "zod";
import { isValidTimeZone } from "@/helpers/companies/time-zone";
import { DEFAULT_WORKING_HOURS, WEEKDAYS, type WorkingHours } from "./config";

// Client-safe (IVT-037, IV-REQ-011): the My calendar form and its action
// validate with the same schema; member_availability's checks mirror it.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use a time like 09:30.");

const dayHours = z
  .object({ start: time, end: time })
  .strict()
  .refine((d) => d.start < d.end, { message: "End after the start.", path: ["end"] });

export const workingHoursSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayHours.optional()])) as Record<(typeof WEEKDAYS)[number], z.ZodOptional<typeof dayHours>>)
  .strict()
  .refine((h) => Object.values(h).some(Boolean), "Pick at least one working day.");

export const availabilitySchema = z
  .object({
    timeZone: z.string().refine(isValidTimeZone, "Pick a time zone from the list."),
    workingHours: workingHoursSchema,
  })
  .strict();

export type AvailabilityInput = z.input<typeof availabilitySchema>;

/**
 * What the form starts from (IV-REQ-011): the saved hours, else Mon–Fri
 * 10–18; the saved zone, else the browser's, else the company's, else UTC.
 */
export function availabilityDefaults(
  saved: { time_zone: string; working_hours: unknown } | null,
  { browserZone, companyZone }: { browserZone: string | null; companyZone: string | null },
): { timeZone: string; workingHours: WorkingHours } {
  const parsed = saved ? workingHoursSchema.safeParse(saved.working_hours) : null;
  return {
    timeZone: saved?.time_zone ?? browserZone ?? companyZone ?? "UTC",
    workingHours: parsed?.success ? parsed.data : DEFAULT_WORKING_HOURS,
  };
}
