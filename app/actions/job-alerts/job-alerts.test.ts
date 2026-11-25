import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ALERT_ID, ALERT_USER_ID, alertRow } from "@/test/utils/job-alerts";
import { JOB_ALERT_COPY } from "@/helpers/job-alerts/alerts";
import { createJobAlertAction } from "./create-job-alert";
import { updateJobAlertAction } from "./update-job-alert";
import { deleteJobAlertAction } from "./delete-job-alert";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn(async (names: string[]) => names) }));

let service: SupabaseMock;

beforeEach(async () => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  const { canonicalizeLocations } = await import("@/helpers/locations/aliases");
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) => names);
  await setRequestUser(mockUser({ id: ALERT_USER_ID }));
});

const SEARCH = "?jobTitleKeywords=frontend&location=pune&sortBy=created_at";

describe("createJobAlertAction (JAT-021, JA-TST-002)", () => {
  it("refuses signed-out callers", async () => {
    await setRequestUser(null);
    expect(await createJobAlertAction({ search: SEARCH, frequency: "weekly", source: "feed_banner" })).toMatchObject({
      ok: false,
      error: JOB_ALERT_COPY.signIn,
    });
    expect(service.calls).toHaveLength(0);
  });

  it("refuses company users", async () => {
    await setRequestUser(mockUser({ type: "company" }));
    expect(await createJobAlertAction({ search: SEARCH, frequency: "weekly", source: "feed_banner" })).toMatchObject({
      ok: false,
      error: JOB_ALERT_COPY.applicantsOnly,
    });
  });

  it("refuses a search with nothing to alert on", async () => {
    expect(await createJobAlertAction({ search: "tab=saved&sortBy=relevance", frequency: "weekly", source: "feed_banner" })).toEqual({
      ok: false,
      reason: "not_alertable",
      error: "Add a role, location or another filter first.",
    });
  });

  it("refuses an agent source from the browser", async () => {
    expect(
      await createJobAlertAction({ search: SEARCH, frequency: "weekly", source: "agent" as "feed_banner" }),
    ).toMatchObject({ ok: false, reason: "bad_input" });
    expect(service.calls).toHaveLength(0);
  });

  it("creates the alert for the session user and captures job_alert_created", async () => {
    service.queue("bookmarks", { data: null, error: null });
    service.queue("bookmarks", { data: null, error: null, count: 0 });
    service.queue("bookmarks", { data: alertRow({ frequency: "daily" }), error: null });

    const result = await createJobAlertAction({ search: SEARCH, frequency: "daily", source: "empty_state" });

    expect(result).toMatchObject({ ok: true, resumed: false, alert: { id: ALERT_ID } });
    const insert = service.callsFor("bookmarks")[2].chain.find((c) => c.method === "insert")!.args[0];
    expect(insert).toMatchObject({ user_id: ALERT_USER_ID, source: "empty_state" });
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: "job_alert_created",
      distinctId: ALERT_USER_ID,
      properties: { source: "empty_state", frequency: "daily", filter_keys: ["jobTitleKeywords", "location"], resumed: false },
    });
  });

  it("captures job_alert_cap_hit at the cap", async () => {
    service.queue("bookmarks", { data: null, error: null });
    service.queue("bookmarks", { data: null, error: null, count: 5 });
    service.queue("bookmarks", { data: null, error: { code: "23514", message: "maximum of 5 Alerts" } });
    expect(await createJobAlertAction({ search: SEARCH, frequency: "weekly", source: "feed_banner" })).toMatchObject({
      ok: false,
      reason: "cap",
    });
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: "job_alert_cap_hit" }));
    expect(eventCaptureServer).not.toHaveBeenCalledWith(expect.objectContaining({ event: "job_alert_created" }));
  });
});

describe("updateJobAlertAction (JAT-022)", () => {
  it.each([
    [{ on: false }, { is_alert_on: false }, ["on"]],
    [{ frequency: "daily" as const }, { frequency: "daily" }, ["frequency"]],
    [{ name: "  My alert " }, { name: "My alert" }, ["name"]],
  ])("updates %o for the session user only", async (input, patch, changed) => {
    service.queue("bookmarks", { data: alertRow(), error: null });
    expect(await updateJobAlertAction({ id: ALERT_ID, ...input })).toMatchObject({ ok: true, changed });
    const chain = service.callsFor("bookmarks")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [patch] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", ALERT_ID] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", ALERT_USER_ID] });
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "job_alert_updated", properties: expect.objectContaining({ changed }) }),
    );
  });

  it("says not found for someone else's alert", async () => {
    service.queue("bookmarks", { data: null, error: null });
    expect(await updateJobAlertAction({ id: ALERT_ID, on: true })).toEqual({
      ok: false,
      reason: "not_found",
      error: "Alert not found.",
    });
  });

  it("maps the cap on resume", async () => {
    service.queue("bookmarks", { data: null, error: { code: "23514", message: "You can only create a maximum of 5 Alerts." } });
    expect(await updateJobAlertAction({ id: ALERT_ID, on: true })).toMatchObject({ ok: false, error: JOB_ALERT_COPY.cap });
  });

  it("refuses an empty name and a bad id", async () => {
    expect(await updateJobAlertAction({ id: ALERT_ID, name: " \n " })).toMatchObject({ ok: false, reason: "bad_input" });
    expect(await updateJobAlertAction({ id: "not-a-uuid", on: true })).toMatchObject({ ok: false, reason: "not_found" });
    expect(service.calls).toHaveLength(0);
  });
});

describe("deleteJobAlertAction (JAT-022)", () => {
  it("deletes the session user's alert", async () => {
    service.queue("bookmarks", { data: [{ id: ALERT_ID }], error: null });
    expect(await deleteJobAlertAction({ id: ALERT_ID })).toEqual({ ok: true });
    const chain = service.callsFor("bookmarks")[0].chain;
    expect(chain).toContainEqual({ method: "delete", args: [] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", ALERT_USER_ID] });
    expect(eventCaptureServer).toHaveBeenCalledWith({ event: "job_alert_deleted", distinctId: ALERT_USER_ID });
  });

  it("says not found when nothing was deleted", async () => {
    service.queue("bookmarks", { data: [], error: null });
    expect(await deleteJobAlertAction({ id: ALERT_ID })).toMatchObject({ ok: false, reason: "not_found" });
  });
});
