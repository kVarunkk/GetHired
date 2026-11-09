/**
 * Fills the resume snapshots of applications made before snapshots existed
 * (RE-REQ-066, RE-REQ-097). Run it after the re-parse (RET-113), then once more
 * to confirm it finds nothing.
 *
 *   npx tsx --env-file=.env scripts/backfill-application-snapshots.ts [--dry-run]
 *
 * Re-runnable: it only reads applications whose `resume_snapshot` is null.
 * Uses NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../utils/types/database.types";
import { backfillApplicationSnapshots } from "../helpers/applications/backfill-snapshots";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const counts = await backfillApplicationSnapshots(admin, { dryRun });
  console.log(`${dryRun ? "[dry run] " : ""}snapshots: ${JSON.stringify(counts)}`);
}

main().catch((error) => {
  console.error("backfill-application-snapshots failed:", error);
  process.exitCode = 1;
});
