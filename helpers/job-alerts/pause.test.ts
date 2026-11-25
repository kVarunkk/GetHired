import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ALERT_ID, ALERT_USER_ID } from "@/test/utils/job-alerts";
import { buildRequest } from "@/test/utils/request";

vi.mock("@/utils/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/formatters")>()),
  INTERNAL_API_SECRET: "test-secret",
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { signAlertPauseToken, verifyAlertPauseToken } from "./pause-token";
import { pauseAlertFromEmail } from "./pause";
import { POST } from "@/app/api/job-alerts/pause/[token]/route";

let db: SupabaseMock;
beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
});

describe("alert pause tokens (JAT-033)", () => {
  it("signs and verifies a token naming the alert", () => {
    expect(verifyAlertPauseToken(signAlertPauseToken(ALERT_ID))).toBe(ALERT_ID);
  });

  it("refuses a tampered token and malformed input", () => {
    const [, sig] = signAlertPauseToken(ALERT_ID).split(".");
    expect(verifyAlertPauseToken(`${ALERT_ID}.${sig}x`)).toBeNull();
    expect(verifyAlertPauseToken(`not-a-uuid.${sig}`)).toBeNull();
    expect(verifyAlertPauseToken("")).toBeNull();
  });

  describe("purposes", () => {
    afterEach(() => vi.doUnmock("server-only"));
    it("never accepts a candidate unsubscribe token for the same id", async () => {
      const { signUnsubscribeToken } = await import("@/helpers/candidates/unsubscribe-token");
      expect(verifyAlertPauseToken(signUnsubscribeToken(ALERT_ID))).toBeNull();
      const { verifyUnsubscribeToken } = await import("@/helpers/candidates/unsubscribe-token");
      expect(verifyUnsubscribeToken(signAlertPauseToken(ALERT_ID))).toBeNull();
    });
  });
});

describe("pauseAlertFromEmail (JAT-033, JA-TST-005)", () => {
  it("pauses the named alert with the service role and captures the event", async () => {
    db.queue("bookmarks", { data: [{ id: ALERT_ID, user_id: ALERT_USER_ID }], error: null });
    expect(await pauseAlertFromEmail(signAlertPauseToken(ALERT_ID), "page")).toEqual({ ok: true, alreadyPaused: false });
    expect(db.callsFor("bookmarks")[0].chain.slice(0, 3)).toEqual([
      { method: "update", args: [{ is_alert_on: false }] },
      { method: "eq", args: ["id", ALERT_ID] },
      { method: "eq", args: ["is_alert_on", true] },
    ]);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: "job_alert_paused_from_email",
      distinctId: ALERT_USER_ID,
      properties: { alert_id: ALERT_ID, via: "page" },
    });
  });

  it("is idempotent for a paused alert", async () => {
    db.queue("bookmarks", { data: [], error: null });
    db.queue("bookmarks", { data: { id: ALERT_ID }, error: null });
    expect(await pauseAlertFromEmail(signAlertPauseToken(ALERT_ID), "page")).toEqual({ ok: true, alreadyPaused: true });
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });

  it("refuses a bad token without touching the DB, and a deleted alert", async () => {
    expect(await pauseAlertFromEmail("x.y", "page")).toEqual({ ok: false });
    expect(db.calls).toHaveLength(0);

    db.queue("bookmarks", { data: [], error: null });
    db.queue("bookmarks", { data: null, error: null });
    expect(await pauseAlertFromEmail(signAlertPauseToken(ALERT_ID), "page")).toEqual({ ok: false });
  });
});

describe("POST /api/job-alerts/pause/[token] (one-click, JA-TST-005)", () => {
  const post = (token: string) =>
    POST(
      buildRequest(`/api/job-alerts/pause/${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      { params: Promise.resolve({ token }) },
    );

  it("pauses on a valid token", async () => {
    db.queue("bookmarks", { data: [{ id: ALERT_ID, user_id: ALERT_USER_ID }], error: null });
    const res = await post(signAlertPauseToken(ALERT_ID));
    expect(res.status).toBe(200);
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { alert_id: ALERT_ID, via: "one_click" } }),
    );
  });

  it("404s on a bad token", async () => {
    expect((await post(`${ALERT_ID}.forged`)).status).toBe(404);
  });
});
