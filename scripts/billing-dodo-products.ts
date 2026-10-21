/**
 * BLT-070: creates the Dodo products for company billing and writes their ids
 * into company_tiers.prices and the company price_plan rows (audience =
 * 'company'). Run once per environment, so test and live ids can differ.
 *
 *   npx tsx --env-file=.env scripts/billing-dodo-products.ts            # dry run, test mode
 *   npx tsx --env-file=.env scripts/billing-dodo-products.ts --apply    # create in test mode
 *   npx tsx --env-file=.env scripts/billing-dodo-products.ts --apply --live
 *
 * Products whose id exists in the mode being run are skipped, so it's safe to
 * rerun. An id from the other mode (e.g. test ids when running --live) is
 * replaced, which is how test products are moved to live.
 * Uses DODO_PAYMENTS_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.
 * With --live, DODO_PAYMENTS_API_KEY must be the live key: .env keeps it as
 * DODO_PAYMENTS_API_KEY_PROD, so pass it in front of the command.
 * Requires the company_billing and billing_subscriptions migrations.
 */
import DodoPayments from "dodopayments";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../utils/types/database.types";

type Price = {
  interval: "month" | "year";
  currency: "USD" | "INR";
  amount_minor: number;
  dodo_product_id: string | null;
};

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");

const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: live ? "live_mode" : "test_mode",
});
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Whether `id` is a product in the mode being run (test ids aren't in live mode). */
async function exists(id: string | null) {
  if (!id) return false;
  try {
    await dodo.products.retrieve(id);
    return true;
  } catch (err) {
    if (err instanceof DodoPayments.NotFoundError) return false;
    throw err;
  }
}

async function createProduct(name: string, description: string, price: DodoPayments.ProductCreateParams["price"]) {
  if (!apply) {
    console.log(`[dry run] would create "${name}" (${JSON.stringify(price)})`);
    return null;
  }
  const product = await dodo.products.create({ name, description, price, tax_category: "saas" });
  console.log(`created ${product.product_id}: ${name}`);
  return product.product_id;
}

async function plans() {
  const { data: tiers, error } = await supabase
    .from("company_tiers")
    .select("id, slug, name, prices")
    .in("slug", ["startup", "growth"]);
  if (error) throw error;

  for (const tier of tiers ?? []) {
    const prices = (tier.prices as unknown as Price[]) ?? [];
    let changed = false;
    for (const p of prices) {
      if (await exists(p.dodo_product_id)) continue;
      const interval = p.interval === "month" ? "Month" : "Year";
      const id = await createProduct(
        `GetHired ${tier.name} (${p.interval === "month" ? "monthly" : "annual"}, ${p.currency})`,
        `GetHired ${tier.name} plan for companies.`,
        {
          type: "recurring_price",
          currency: p.currency,
          price: p.amount_minor,
          discount: 0,
          payment_frequency_count: 1,
          payment_frequency_interval: interval,
          subscription_period_count: p.interval === "month" ? 120 : 10,
          subscription_period_interval: interval,
          tax_inclusive: false,
        },
      );
      if (id) {
        p.dodo_product_id = id;
        changed = true;
      }
    }
    if (changed) {
      const { error: updateError } = await supabase
        .from("company_tiers")
        .update({ prices: prices as unknown as Json })
        .eq("id", tier.id);
      if (updateError) throw updateError;
    }
  }
}

async function creditPacks() {
  const { data: packs, error } = await supabase
    .from("price_plan")
    .select("id, name, credit_amount, amount, product_id")
    .eq("audience", "company");
  if (error) throw error;

  for (const pack of packs ?? []) {
    if (!pack.amount || (await exists(pack.product_id))) continue;
    const id = await createProduct(
      `GetHired ${pack.credit_amount} company credits`,
      "Company credits for usage beyond your plan's allowances.",
      { type: "one_time_price", currency: "USD", price: Math.round(pack.amount * 100), discount: 0, tax_inclusive: false },
    );
    if (id) {
      const { error: updateError } = await supabase.from("price_plan").update({ product_id: id }).eq("id", pack.id);
      if (updateError) throw updateError;
    }
  }
}

async function main() {
  console.log(`${apply ? "Creating" : "Dry run"} in ${live ? "LIVE" : "test"} mode`);
  await plans();
  await creditPacks();
  console.log("Done. Plans are cached for up to an hour (tag billing-plans).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
