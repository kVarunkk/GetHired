import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/helpers/posthog/report-error";
import { addTrackedApplication } from "@/helpers/tracker/add-tracked-application";
import { findBoardJobIdByUrl } from "@/helpers/tracker/board-match";
import { EXTENSION_UNDO_WINDOW_MS, requireExtensionApplicant, trackLimiter, trackResponse } from "@/helpers/tracker/extension-api";
import { stripControlChars, trackedInputSchema, TRACKER_LIMITS } from "@/helpers/tracker/schema";
import { revalidateMyJobs } from "@/helpers/tracker/session";

// The extension's tracking route (AT-REQ-060, AT-REQ-061). Only the link, the
// title, the company and the location arrive: never the form or its answers
// (AT-REQ-071).

const bodySchema = z.object({
  url: z.string().min(1).max(TRACKER_LIMITS.url),
  title: z.string().max(2000).optional(),
  company: z.string().max(2000).optional(),
  location: z.string().max(2000).optional(),
  trigger: z.enum(["submit", "manual"]),
  status: z.enum(["saved", "applied"]).optional(),
});

/** Trimmed, one line, and no longer than the column. */
const tidy = (value: string | undefined, max: number) => {
  const text = stripControlChars(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text || undefined;
};

export async function POST(request: NextRequest) {
  try {
    const session = await requireExtensionApplicant();
    if (!session.ok) return session.response;
    const { ctx } = session;

    const limit = trackLimiter.hit(ctx.user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { message: "Too many applications tracked this hour." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "Invalid request" }, { status: 400 });
    const body = parsed.data;

    // A detected submit is always an application; only the popup picks Saved.
    const status = body.trigger === "manual" ? (body.status ?? "applied") : "applied";
    const title = tidy(body.title, TRACKER_LIMITS.title);
    const company = tidy(body.company, TRACKER_LIMITS.company);

    let candidate: unknown;
    if (title && company) {
      candidate = { jobTitle: title, companyName: company, jobUrl: body.url, location: tidy(body.location, TRACKER_LIMITS.location), status };
    } else {
      // Details missing: a job on the board fills them in (AT-REQ-031).
      const allJobsId = await findBoardJobIdByUrl(body.url);
      if (!allJobsId) {
        return NextResponse.json({ message: "The job's title and company are needed.", code: "missing_details" }, { status: 400 });
      }
      candidate = { allJobsId, status };
    }

    const input = trackedInputSchema.safeParse(candidate);
    if (!input.success) return NextResponse.json({ message: input.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

    const result = await addTrackedApplication(ctx, input.data, "extension");
    if (result.ok) revalidateMyJobs();
    return trackResponse(result);
  } catch (error) {
    reportError(error, { route: "extension/track-application" });
    return NextResponse.json({ message: "Something went wrong." }, { status: 500 });
  }
}

/** Undo: removes a card the extension added in the last 10 minutes. */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireExtensionApplicant();
    if (!session.ok) return session.response;
    const { ctx } = session;

    const id = z.string().uuid().safeParse(request.nextUrl.searchParams.get("id"));
    if (!id.success) return NextResponse.json({ message: "Invalid request" }, { status: 400 });

    const { data: row, error } = await ctx.supabase
      .from("tracked_applications")
      .select("id, source, created_at")
      .eq("id", id.data)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ message: "Application not found." }, { status: 404 });

    const since = new Date(Date.now() - EXTENSION_UNDO_WINDOW_MS).toISOString();
    if (row.source !== "extension" || row.created_at < since) {
      return NextResponse.json({ message: "Remove it from My Jobs instead.", code: "not_undoable" }, { status: 409 });
    }

    const { error: deleteError } = await ctx.supabase
      .from("tracked_applications")
      .delete()
      .eq("id", id.data)
      .eq("user_id", ctx.user.id)
      .eq("source", "extension")
      .gte("created_at", since);
    if (deleteError) throw deleteError;

    revalidateMyJobs();
    return NextResponse.json({ removed: true, id: id.data });
  } catch (error) {
    reportError(error, { route: "extension/track-application" });
    return NextResponse.json({ message: "Something went wrong." }, { status: 500 });
  }
}
