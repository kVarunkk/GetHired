import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/helpers/posthog/report-error";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { LINK_IP_LIMIT, LINK_LIMIT_WINDOW_SECONDS, LINK_TOKEN_LIMIT } from "@/helpers/calendar/config";
import { bookByToken, cancelByToken, rescheduleByToken, type ChangeResult } from "@/helpers/interviews/self-scheduling";
import { selfSchedulingMessage } from "@/helpers/interviews/self-scheduling-copy";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("book"),
    startsAt: z.string().datetime({ offset: true }),
    timeZone: z.string().max(64).optional(),
  }),
  z.object({ action: z.literal("reschedule"), startsAt: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal("cancel") }),
]);

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const STATUS: Record<string, number> = { not_found: 404, invalid: 400, rate_limited: 429 };

function respond(result: ChangeResult) {
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(result, { status: STATUS[result.reason] ?? 409 });
}

const refuse = (reason: string) => respond({ ok: false, reason, error: selfSchedulingMessage(reason) });

/**
 * POST /api/schedule/[token] (IVT-063, IV-REQ-021/022, IV-SEC-003): the
 * candidate books, reschedules or cancels through their link, without
 * signing in (the path is in the middleware's public checks). The token is
 * checked in SQL; this route holds the service role, so it's rate-limited
 * per token and per IP before anything else runs.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!calendarEnabled()) return refuse("not_found");
  const { token } = await params;
  if (!token || token.length < 20 || token.length > 200) return refuse("not_found");

  const admin = createServiceRoleClient();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  // Hashed: neither the token nor the address is stored.
  for (const [key, limit] of [
    [`token:${sha256(token)}`, LINK_TOKEN_LIMIT],
    [`ip:${sha256(ip)}`, LINK_IP_LIMIT],
  ] as const) {
    const { data: allowed, error } = await admin.rpc("take_scheduling_link_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: LINK_LIMIT_WINDOW_SECONDS,
    });
    if (error) {
      reportError("[schedule] the rate limit couldn't be checked", error.code);
      return refuse("error");
    }
    if (!allowed) return refuse("rate_limited");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid");
  const body = parsed.data;

  try {
    const deps = { admin, provider: calendarProvider() };
    switch (body.action) {
      case "book":
        return respond(await bookByToken(deps, token, { startsAt: body.startsAt, timeZone: body.timeZone }));
      case "reschedule":
        return respond(await rescheduleByToken(deps, token, { startsAt: body.startsAt }));
      case "cancel":
        return respond(await cancelByToken(deps, token));
    }
  } catch (err) {
    reportError("[schedule] the change failed", body.action, err instanceof Error ? err.message : "error");
    return NextResponse.json({ ok: false, reason: "error", error: selfSchedulingMessage("error") }, { status: 500 });
  }
}
