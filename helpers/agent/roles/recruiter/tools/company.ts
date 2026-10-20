import { tool } from "ai";
import { z } from "zod";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { RA_UPGRADE_URL } from "../config";
import { type RecruiterToolContext, withToolErrors } from "./shared";

const orUnlimited = (value: number | null) => value ?? "unlimited";

export function createCompanyTools(ctx: RecruiterToolContext) {
  return {
    getMyCompany: tool({
      description:
        "Get the company's plan, AI credit balance and what's left of this month's limits (job posts, candidates per search, screenings, agent messages, match explanations).",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "getMyCompany", async () => {
          const { tier, creditBalance, period, entitlements } = await getEntitlements(ctx.company.id);
          const limits = Object.fromEntries(
            Object.entries(entitlements).map(([key, state]) => [
              key,
              { used: state.used, limit: orUnlimited(state.amount), remaining: orUnlimited(state.remaining) },
            ]),
          );
          return {
            name: ctx.company.name,
            plan: tier.name,
            creditBalance,
            periodEnds: period.end,
            limits,
            billingUrl: RA_UPGRADE_URL,
          };
        }),
    }),
  };
}
