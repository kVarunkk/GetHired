import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import { newestApplications } from "@/helpers/tracker/card";
import { boardUrlFor, requireExtensionApplicant } from "@/helpers/tracker/extension-api";
import { listMyApplications } from "@/helpers/tracker/list-my-applications";
import { trackedApplicationPath } from "@/helpers/tracker/paths";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/** The popup's list (AT-REQ-062): the newest applications, never saved jobs. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireExtensionApplicant();
    if (!session.ok) return session.response;

    const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const items = await listMyApplications(session.ctx);
    return NextResponse.json({
      applications: newestApplications(items, limit).map((item) => ({
        id: item.id,
        title: item.jobTitle,
        company: item.companyName,
        statusLabel: item.statusLabel,
        appliedAt: item.appliedAt,
        boardUrl: boardUrlFor(trackedApplicationPath(item.id)),
      })),
    });
  } catch (error) {
    reportError(error, { route: "extension/tracked-applications" });
    return NextResponse.json({ message: "Something went wrong." }, { status: 500 });
  }
}
