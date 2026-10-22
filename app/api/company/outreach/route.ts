import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { requireCompany } from "@/helpers/companies/require-company";
import { OUTREACH_STATUSES } from "@/helpers/outreach/config";
import { listCompanyOutreach } from "@/helpers/outreach/list";
import { sendOutreach } from "@/helpers/outreach/send";
import type { OutreachStatus } from "@/utils/types/outreach.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/company/outreach (spec §4): sends an outreach for the session
 * company, the same way as the composer. Used by the MCP server.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCompany({ permission: "outreach.send" });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const result = await sendOutreach(auth, body, { source: "manual" });

  if (result.ok) return NextResponse.json({ outreach: result.outreach, emailed: result.emailed });
  if (typeof result.error === "object") {
    // The monthly allowance: 402 with the entitlement payload (BL-REQ-020),
    // so clients can show the upgrade dialog.
    return NextResponse.json({ ...result.error, error: "OUTREACH_LIMIT" }, { status: 402 });
  }
  const code = "code" in result ? result.code : "UNKNOWN";
  const status = "status" in result ? result.status : 500;
  return NextResponse.json({ error: code, message: result.error }, { status });
}

/** GET /api/company/outreach?jobPostId&status&cursor: the company's outreach, 25 a page. */
export async function GET(request: NextRequest) {
  const auth = await requireCompany({ permission: "outreach.view" });
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const jobPostId = params.get("jobPostId");
  const status = params.get("status");
  if (jobPostId && !UUID.test(jobPostId)) {
    return NextResponse.json({ error: "Invalid jobPostId" }, { status: 400 });
  }
  if (status && !(OUTREACH_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const page = await listCompanyOutreach(auth, {
      jobPostId,
      status: status as OutreachStatus | null,
      cursor: params.get("cursor"),
    });
    return NextResponse.json(page);
  } catch (err) {
    reportError("[outreach] list failed:", err);
    return NextResponse.json({ error: "Couldn't load outreach." }, { status: 500 });
  }
}
