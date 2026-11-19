import { NextResponse } from "next/server";

/** IndexNow ownership proof: the key as plain text (referenced by `keyLocation`). */
export function GET() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(key, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
