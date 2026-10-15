import { NextRequest, NextResponse } from "next/server";
import { requireCompany } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { toEntitlementResponse } from "@/helpers/billing/errors";
import { queueJobScreenings } from "@/helpers/matching/queue-screenings";

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

const FAILURES = {
  load_failed: { status: 500, error: "Couldn't load the applications." },
  queue_failed: { status: 500, error: "Couldn't queue the screenings." },
  send_failed: { status: 502, error: "Couldn't queue the screenings. Please try again." },
} as const;

/**
 * Queues a screening for every application to one of the company's jobs that
 * has none, or a stale, failed or skipped one (MT-REQ-005, MT-TASK-023; see
 * `helpers/matching/queue-screenings.ts`). Returns `{ queued }`, or a 402 when
 * new screenings are needed and the plan can't pay for even one.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;

  const { job_id: jobPostId } = await params;
  if (!isUuid(jobPostId)) return notFound();

  const result = await queueJobScreenings(auth, jobPostId);
  if (result.ok) return NextResponse.json({ queued: result.queued });
  if (result.reason === "not_found") return notFound();
  if (result.reason === "entitlement") return toEntitlementResponse(result.error);

  const failure = FAILURES[result.reason];
  return NextResponse.json({ error: failure.error }, { status: failure.status });
}
