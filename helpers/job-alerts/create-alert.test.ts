import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ALERT_USER_ID, alertRow } from "@/test/utils/job-alerts";

vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { JOB_ALERT_COPY, MAX_JOB_ALERT_ROWS } from "./alerts";
import { createJobAlert } from "./create-alert";
import { alertFiltersFromSearchParams } from "./filters";

let db: SupabaseMock;
const ctx = () => ({ userId: ALERT_USER_ID, supabase: db.client });
const filters = (search: string) => alertFiltersFromSearchParams(search);

const chainOf = (table: string, index = 0) => db.callsFor(table)[index].chain;
const methodArgs = (table: string, method: string, index = 0) =>
  chainOf(table, index).filter((c) => c.method === method).map((c) => c.args);

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((n) => (n.toLowerCase() === "bangalore" ? "Bengaluru" : n)),
  );
});

describe("createJobAlert (JAT-020, JA-TST-002)", () => {
  it("refuses a search with nothing to alert on", async () => {
    expect(await createJobAlert(ctx(), { filters: null, frequency: "weekly", source: "feed_banner" })).toEqual({
      ok: false,
      reason: "not_alertable",
      error: JOB_ALERT_COPY.notAlertable,
    });
    expect(db.calls).toHaveLength(0);
  });

  it("inserts a named, canonical alert for the context's user", async () => {
    db.queue("bookmarks", { data: null, error: null }); // no existing key
    db.queue("bookmarks", { data: null, error: null, count: 2 }); // row count
    db.queue("bookmarks", {
      data: alertRow({ name: "Frontend jobs in Bengaluru", filters: { location: ["bengaluru"] } }),
      error: null,
    });

    const result = await createJobAlert(ctx(), {
      filters: filters("jobTitleKeywords=Frontend&location=Bangalore&sortBy=relevance"),
      frequency: "daily",
      source: "feed_banner",
    });

    expect(result).toMatchObject({ ok: true, resumed: false });
    const [insert] = methodArgs("bookmarks", "insert", 2)[0] as [Record<string, unknown>];
    expect(insert).toEqual({
      user_id: ALERT_USER_ID,
      name: "Frontend jobs in Bengaluru",
      url: "/jobs?jobTitleKeywords=frontend&location=bengaluru",
      filters: { jobTitleKeywords: ["frontend"], location: ["bengaluru"] },
      filters_key: '{"jobTitleKeywords":["frontend"],"location":["bengaluru"]}',
      frequency: "daily",
      source: "feed_banner",
      is_alert_on: true,
    });
    expect(methodArgs("bookmarks", "eq", 0)).toContainEqual(["user_id", ALERT_USER_ID]);
    expect(methodArgs("bookmarks", "eq", 1)).toContainEqual(["user_id", ALERT_USER_ID]);
  });

  it("returns an active alert for the same search without writing (idempotent)", async () => {
    db.queue("bookmarks", { data: alertRow({ is_alert_on: true, frequency: "weekly" }), error: null });
    const result = await createJobAlert(ctx(), {
      filters: filters("location=pune&jobTitleKeywords=frontend"),
      frequency: "weekly",
      source: "feed_banner",
    });
    expect(result).toMatchObject({ ok: true, resumed: true, alert: { on: true } });
    expect(db.callsFor("bookmarks")).toHaveLength(1);
  });

  it("resumes a paused alert for the same search with the new frequency", async () => {
    db.queue("bookmarks", { data: alertRow({ is_alert_on: false }), error: null });
    db.queue("bookmarks", { data: alertRow({ is_alert_on: true, frequency: "daily" }), error: null });
    const result = await createJobAlert(ctx(), {
      filters: filters("location=pune&jobTitleKeywords=frontend"),
      frequency: "daily",
      source: "feed_banner",
    });
    expect(result).toMatchObject({ ok: true, resumed: true, alert: { on: true, frequency: "daily" } });
    expect(methodArgs("bookmarks", "update", 1)[0]).toEqual([{ is_alert_on: true, frequency: "daily" }]);
    expect(methodArgs("bookmarks", "eq", 1)).toEqual([
      ["id", alertRow().id],
      ["user_id", ALERT_USER_ID],
    ]);
  });

  it("maps the cap trigger to the cap copy, on insert and on resume", async () => {
    const capError = { code: "23514", message: "You can only create a maximum of 5 Alerts." };
    db.queue("bookmarks", { data: null, error: null });
    db.queue("bookmarks", { data: null, error: null, count: 5 });
    db.queue("bookmarks", { data: null, error: capError });
    expect(
      await createJobAlert(ctx(), { filters: filters("location=goa"), frequency: "weekly", source: "feed_banner" }),
    ).toEqual({ ok: false, reason: "cap", error: JOB_ALERT_COPY.cap });

    db.reset();
    db.queue("bookmarks", { data: alertRow({ is_alert_on: false }), error: null });
    db.queue("bookmarks", { data: null, error: capError });
    expect(
      await createJobAlert(ctx(), { filters: filters("location=pune"), frequency: "weekly", source: "feed_banner" }),
    ).toMatchObject({ ok: false, reason: "cap", error: JOB_ALERT_COPY.cap });
  });

  it(`refuses a ${MAX_JOB_ALERT_ROWS + 1}st row`, async () => {
    db.queue("bookmarks", { data: null, error: null });
    db.queue("bookmarks", { data: null, error: null, count: MAX_JOB_ALERT_ROWS });
    expect(
      await createJobAlert(ctx(), { filters: filters("location=goa"), frequency: "weekly", source: "feed_banner" }),
    ).toEqual({ ok: false, reason: "row_limit", error: JOB_ALERT_COPY.rowLimit });
    expect(db.callsFor("bookmarks")).toHaveLength(2);
  });

  it("returns the other tab's alert after a unique-key race", async () => {
    db.queue("bookmarks", { data: null, error: null });
    db.queue("bookmarks", { data: null, error: null, count: 0 });
    db.queue("bookmarks", { data: null, error: { code: "23505", message: "duplicate key" } });
    db.queue("bookmarks", { data: alertRow(), error: null });
    expect(
      await createJobAlert(ctx(), {
        filters: filters("location=pune&jobTitleKeywords=frontend"),
        frequency: "weekly",
        source: "feed_banner",
      }),
    ).toMatchObject({ ok: true, resumed: true });
  });

  describe("salary currency", () => {
    const insertOf = () => methodArgs("bookmarks", "insert", 2)[0][0] as Record<string, unknown>;

    it("keeps the search's currency", async () => {
      db.queue("bookmarks", { data: null, error: null });
      db.queue("bookmarks", { data: null, error: null, count: 0 });
      db.queue("bookmarks", { data: alertRow(), error: null });
      await createJobAlert(ctx(), {
        filters: filters("minSalary=100000&salaryCurrency=USD"),
        frequency: "weekly",
        source: "feed_banner",
      });
      expect(db.callsFor("user_info")).toHaveLength(0);
      expect(insertOf().filters).toEqual({ minSalary: 100000, salaryCurrency: "USD" });
    });

    it("takes the profile's currency for a salary without one", async () => {
      db.queue("user_info", { data: { salary_currency: "INR" }, error: null });
      db.queue("bookmarks", { data: null, error: null });
      db.queue("bookmarks", { data: null, error: null, count: 0 });
      db.queue("bookmarks", { data: alertRow(), error: null });
      await createJobAlert(ctx(), { filters: filters("minSalary=2000000"), frequency: "weekly", source: "feed_banner" });
      expect(db.callsFor("user_info")[0].chain).toContainEqual({ method: "eq", args: ["user_id", ALERT_USER_ID] });
      expect(insertOf()).toMatchObject({
        filters: { minSalary: 2000000, salaryCurrency: "INR" },
        name: "Jobs · ₹20L+",
      });
    });

    it("refuses when the profile has no currency either", async () => {
      db.queue("user_info", { data: { salary_currency: null }, error: null });
      expect(
        await createJobAlert(ctx(), { filters: filters("minSalary=5"), frequency: "weekly", source: "feed_banner" }),
      ).toEqual({ ok: false, reason: "no_currency", error: JOB_ALERT_COPY.noCurrency });
    });
  });
});
