// Client-safe. What Add job tells the user after a result (AT-REQ-036).

import { TRACKER_COPY } from "./copy";
import { myJobsPath, trackedApplicationPath } from "./paths";
import type { TrackedStatus } from "./status";

export type AddResultLike =
  | { ok: true; kind: "tracked"; created: boolean; moved: boolean; id: string; status: TrackedStatus }
  | { ok: true; kind: "favorite"; allJobsId: string }
  | { ok: false; reason: string; error: string; applicationId?: string };

export type AddResultView = { tone: "success" | "info" | "error"; message: string; href: string | null };

/** The message, tone and link for each way Add job can end. */
export function addResultView(result: AddResultLike): AddResultView {
  if (!result.ok) {
    if (result.reason === "applied_on_gethired" && result.applicationId) {
      return { tone: "info", message: result.error, href: trackedApplicationPath(result.applicationId) };
    }
    return { tone: "error", message: result.error, href: null };
  }
  if (result.kind === "favorite") return { tone: "success", message: TRACKER_COPY.saved, href: myJobsPath({ tab: "saved" }) };
  if (result.moved) return { tone: "success", message: TRACKER_COPY.moved, href: trackedApplicationPath(result.id) };
  if (!result.created) {
    return {
      tone: "info",
      message: TRACKER_COPY.exists,
      href: result.status === "saved" ? myJobsPath({ tab: "saved" }) : trackedApplicationPath(result.id),
    };
  }
  return result.status === "saved"
    ? { tone: "success", message: TRACKER_COPY.saved, href: myJobsPath({ tab: "saved" }) }
    : { tone: "success", message: TRACKER_COPY.added, href: trackedApplicationPath(result.id) };
}
