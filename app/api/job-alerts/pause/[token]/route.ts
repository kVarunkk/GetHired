import { NextResponse } from "next/server";
import { pauseAlertFromEmail } from "@/helpers/job-alerts/pause";

/**
 * JA-REQ-035/036: the `List-Unsubscribe` target. Mail clients POST
 * `List-Unsubscribe=One-Click` here (RFC 8058) with no session; the signed
 * token is the only authority. Public (middleware). A GET does nothing, so
 * a link scanner can't pause anyone; people use /unsubscribe/alert/[token].
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await pauseAlertFromEmail(decodeURIComponent(token), "one_click");
  if (!result.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
