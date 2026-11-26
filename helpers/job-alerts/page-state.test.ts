import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ALERT_USER_ID } from "@/test/utils/job-alerts";

vi.mock("@/helpers/locations/aliases", () => ({
  canonicalizeLocations: vi.fn(async (names: string[]) => names.map((n) => (n === "bengaluru" ? "bangalore" : n))),
}));

import { canonicalAlert } from "./canonical";
import { alertFiltersFromSearchParams } from "./filters";
import { loadJobAlertFeedState } from "./page-state";

let db: SupabaseMock;
beforeEach(() => {
  db = createSupabaseMock();
});

const load = (searchParams: Record<string, string>, userId: string | null = ALERT_USER_ID, isCompany = false) =>
  loadJobAlertFeedState({ supabase: db.client, userId, isCompany, searchParams });

describe("loadJobAlertFeedState (JAT-043)", () => {
  it("has no key for a non-alertable search and reads nothing", async () => {
    const state = await load({ tab: "saved" });
    expect(state.filtersKey).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("reads nothing for a signed-out viewer or a company", async () => {
    expect((await load({ location: "pune" }, null)).isLoggedIn).toBe(false);
    expect((await load({ location: "pune" }, ALERT_USER_ID, true)).alert.state).toBe("none");
    expect(db.calls).toHaveLength(0);
  });

  it("matches the search's canonical key and counts active alerts, scoped to the user", async () => {
    const { key } = await canonicalAlert(alertFiltersFromSearchParams({ location: "bengaluru" })!);
    db.queue("bookmarks", {
      data: [
        { id: "a1", filters_key: key, is_alert_on: false, frequency: "daily" },
        { id: "a2", filters_key: "other", is_alert_on: true, frequency: "weekly" },
        { id: "a3", filters_key: "third", is_alert_on: true, frequency: "weekly" },
      ],
      error: null,
    });
    const state = await load({ location: "bengaluru" });
    expect(state.filtersKey).toBe(key);
    expect(state.alert).toEqual({ state: "paused", id: "a1", frequency: "daily" });
    expect(state.activeCount).toBe(2);
    expect(db.callsFor("bookmarks")).toHaveLength(1);
    expect(db.callsFor("bookmarks")[0].chain).toContainEqual({ method: "eq", args: ["user_id", ALERT_USER_ID] });
  });

  it("falls back to no alert when the read fails", async () => {
    db.queue("bookmarks", { data: null, error: { message: "boom" } });
    expect((await load({ location: "pune" })).alert.state).toBe("none");
  });
});
