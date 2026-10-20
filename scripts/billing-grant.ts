/**
 * Manual billing grants (BL-REQ-015), the same as POST /api/internal/billing/grant.
 *
 *   npx tsx --env-file=.env scripts/billing-grant.ts '<json>'
 *
 * Examples:
 *   '{"companyId":"<uuid>","plan":{"slug":"startup","until":"2027-01-31T00:00:00Z"}}'
 *   '{"companyId":"<uuid>","credits":{"amount":500,"expiresAt":"2027-10-01T00:00:00Z","note":"pilot"}}'
 *
 * Founding grants (BL-DEC-006) for every company created before a date:
 *   npx tsx --env-file=.env scripts/billing-grant.ts --founding-before 2026-11-01T00:00:00Z [--dry-run]
 * Each gets the `founding` plan for 3 months. Companies on a paid Dodo
 * subscription are skipped (set_company_plan refuses them).
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../utils/types/database.types";
import { applyBillingGrant, grantSchema } from "../helpers/billing/grant";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function founding(before: string, dryRun: boolean) {
  const until = new Date();
  until.setMonth(until.getMonth() + 3);

  const { data: companies, error } = await supabase
    .from("company_info")
    .select("id, name, created_at")
    .lt("created_at", before);
  if (error) throw error;

  let granted = 0;
  for (const c of companies ?? []) {
    if (dryRun) {
      console.log(`[dry run] founding until ${until.toISOString()}: ${c.name} (${c.id})`);
      continue;
    }
    try {
      await applyBillingGrant(supabase, {
        companyId: c.id,
        plan: { slug: "founding", until: until.toISOString() },
        note: "Founding offer (BL-DEC-006)",
      });
      granted += 1;
      console.log(`founding: ${c.name} (${c.id})`);
    } catch (err) {
      console.error(`skipped ${c.name} (${c.id}):`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`${dryRun ? "Would grant" : "Granted"} founding to ${dryRun ? companies?.length : granted} companies.`);
}

async function main() {
  const args = process.argv.slice(2);
  const foundingIdx = args.indexOf("--founding-before");
  if (foundingIdx >= 0) {
    await founding(args[foundingIdx + 1], args.includes("--dry-run"));
    return;
  }

  const parsed = grantSchema.safeParse(JSON.parse(args[0] ?? "null"));
  if (!parsed.success) {
    console.error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  console.log(await applyBillingGrant(supabase, parsed.data));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
