import "server-only";
import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { deploymentUrl } from "@/utils/formatters";
import { createMemoryRateLimiter, type RateLimiter } from "@/helpers/net/memory-rate-limit";
import type { AddTrackedResult } from "./add-tracked-application";
import type { TrackerContext } from "./context";
import { myJobsPath, trackedApplicationPath } from "./paths";

// What the GetHired Autofill extension's routes share (AT-REQ-060–062).

export const EXTENSION_TRACKS_PER_HOUR = 60;
/** How long after the extension adds a card its Undo can remove it (AT-REQ-061). */
export const EXTENSION_UNDO_WINDOW_MS = 10 * 60 * 1000;

export const trackLimiter: RateLimiter = createMemoryRateLimiter({
  limit: EXTENSION_TRACKS_PER_HOUR,
  windowMs: 60 * 60 * 1000,
});

/** The session applicant (cookie or bearer token), or the error response to send. */
export async function requireExtensionApplicant(): Promise<
  { ok: true; ctx: TrackerContext } | { ok: false; response: NextResponse }
> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, response: NextResponse.json({ message: "Invalid session" }, { status: 401 }) };
  // OAuth app tokens (client_id) are refused by the middleware before this runs.
  if (user.app_metadata?.type === "company") {
    return { ok: false, response: NextResponse.json({ message: "Only applicants can track applications." }, { status: 403 }) };
  }
  const supabase = await createClient();
  return { ok: true, ctx: { supabase, user: { id: user.id } } };
}

/** A path on the site as a full link, for the extension to open. */
export const boardUrlFor = (path: string) => `${deploymentUrl()}${path}`;

export type TrackResponseStatus = "created" | "saved" | "moved" | "exists" | "applied_on_gethired";

/** The extension's answer for each way adding can end. */
export function trackResponse(result: AddTrackedResult): NextResponse {
  if (!result.ok) {
    if (result.reason === "applied_on_gethired") {
      return NextResponse.json({
        status: "applied_on_gethired" satisfies TrackResponseStatus,
        id: result.applicationId,
        boardUrl: boardUrlFor(trackedApplicationPath(result.applicationId)),
      });
    }
    const status = result.reason === "not_found" ? 404 : result.reason === "error" ? 500 : 422;
    return NextResponse.json({ message: result.error, code: result.reason }, { status });
  }

  if (result.kind === "favorite") {
    return NextResponse.json({
      status: "saved" satisfies TrackResponseStatus,
      id: result.allJobsId,
      boardUrl: boardUrlFor(myJobsPath({ tab: "saved" })),
    });
  }

  const saved = result.status === "saved";
  const status: TrackResponseStatus = result.moved ? "moved" : !result.created ? "exists" : saved ? "saved" : "created";
  return NextResponse.json({
    status,
    id: result.id,
    boardUrl: boardUrlFor(saved ? myJobsPath({ tab: "saved" }) : trackedApplicationPath(result.id)),
  });
}
