import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

// BL-REQ-015: manual plans (pilots, founding) and credit grants. Used by the
// internal route and by scripts/billing-grant.ts, so no server-only import and
// the service-role client is passed in.

export const grantSchema = z
  .object({
    companyId: z.string().uuid(),
    plan: z
      .object({
        slug: z.string().min(1),
        until: z.string().datetime({ offset: true }).nullable(),
      })
      .strict()
      .optional(),
    credits: z
      .object({
        amount: z.number().int().positive(),
        expiresAt: z.string().datetime({ offset: true }).nullable(),
        note: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((g) => g.plan || g.credits, { message: "Give a plan, credits or both." })
  .refine((g) => !g.plan?.until || new Date(g.plan.until) > new Date(), {
    message: "The plan end must be in the future.",
    path: ["plan", "until"],
  })
  .refine((g) => !g.credits?.expiresAt || new Date(g.credits.expiresAt) > new Date(), {
    message: "The credit expiry must be in the future.",
    path: ["credits", "expiresAt"],
  });

export type BillingGrant = z.infer<typeof grantSchema>;

export class GrantError extends Error {}

export async function applyBillingGrant(
  supabase: SupabaseClient<Database>,
  grant: BillingGrant,
  actorUserId?: string,
): Promise<{ planSet: boolean; creditLotId: string | null }> {
  let planSet = false;
  let creditLotId: string | null = null;

  if (grant.plan) {
    const { error } = await supabase.rpc("set_company_plan", {
      p_company_id: grant.companyId,
      p_tier_slug: grant.plan.slug,
      // null = no end date; the generated type doesn't know the SQL accepts it.
      p_until: grant.plan.until as string,
      p_note: grant.note,
      ...(actorUserId ? { p_actor: actorUserId } : {}),
    });
    if (error) {
      // 22023 = invalid_parameter_value: unknown plan or a past end date.
      if (error.code === "22023") throw new GrantError(error.message);
      throw new Error(`set_company_plan: ${error.message}`);
    }
    planSet = true;
  }

  if (grant.credits) {
    const { data, error } = await supabase.rpc("grant_company_credits", {
      p_company_id: grant.companyId,
      p_amount: grant.credits.amount,
      p_reason: "grant",
      p_expires_at: grant.credits.expiresAt as string,
      p_note: grant.credits.note ?? grant.note,
      ...(actorUserId ? { p_actor: actorUserId } : {}),
    });
    if (error) {
      if (error.code === "22023") throw new GrantError(error.message);
      throw new Error(`grant_company_credits: ${error.message}`);
    }
    creditLotId = data as string;
  }

  return { planSet, creditLotId };
}
