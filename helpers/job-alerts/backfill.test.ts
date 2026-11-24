import { describe, expect, it } from "vitest";
import { backfillCounts, planBackfill, type Canonicalize, type LegacyBookmark } from "./backfill";
import { filtersKey } from "./filters";

const canonicalize: Canonicalize = async (filters) => ({ filters, key: filtersKey(filters) });

const row = (id: string, url: string | null, created_at = "2026-01-01T00:00:00Z", user_id = "u1"): LegacyBookmark => ({
  id,
  user_id,
  url,
  created_at,
});

describe("planBackfill (JAT-071)", () => {
  it("fills filters, key, name, url and source for a normal row", async () => {
    const plan = await planBackfill([row("b1", "/jobs?jobTitleKeywords=frontend&location=pune")], canonicalize);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      expect.objectContaining({
        id: "b1",
        filters: { jobTitleKeywords: ["frontend"], location: ["pune"] },
        name: "Frontend jobs in Pune",
        source: "legacy_bookmark",
      }),
    ]);
    expect(plan.updates[0].filters_key).toBe(filtersKey(plan.updates[0].filters));
    expect(plan.updates[0].url).toBe("/jobs?jobTitleKeywords=frontend&location=pune");
  });

  it("deletes a Saved-tab or empty url", async () => {
    const plan = await planBackfill(
      [row("b1", "/jobs?tab=saved"), row("b2", "/jobs?tab=applied&location=pune"), row("b3", "/jobs"), row("b4", null)],
      canonicalize,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.deletes.map((d) => [d.id, d.why])).toEqual([
      ["b1", "not_alertable"],
      ["b2", "not_alertable"],
      ["b3", "not_alertable"],
      ["b4", "not_alertable"],
    ]);
  });

  it("keeps a relevance search, dropping the sort", async () => {
    const plan = await planBackfill([row("b1", "/jobs?sortBy=relevance&location=pune")], canonicalize);
    expect(plan.updates[0].filters).toEqual({ location: ["pune"] });
    expect(plan.updates[0].url).not.toContain("sortBy");
  });

  it("reads a repeated createdAfter once", async () => {
    const plan = await planBackfill([row("b1", "/jobs?createdAfter=7&createdAfter=30&location=pune")], canonicalize);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].url).not.toMatch(/createdAfter.*createdAfter/);
  });

  it("keeps the oldest of a collision and deletes the rest", async () => {
    const plan = await planBackfill(
      [
        row("new", "/jobs?location=pune", "2026-03-01T00:00:00Z"),
        row("old", "/jobs?location=pune", "2026-01-01T00:00:00Z"),
        row("mid", "/jobs?location=Pune&sortBy=relevance", "2026-02-01T00:00:00Z"),
      ],
      canonicalize,
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["old"]);
    expect(plan.deletes).toEqual([
      { id: "mid", why: "duplicate" },
      { id: "new", why: "duplicate" },
    ]);
  });

  it("collisions are per user, and an existing key wins over a legacy row", async () => {
    const key = filtersKey({ location: ["pune"] });
    const plan = await planBackfill(
      [
        row("a", "/jobs?location=pune", "2026-01-01T00:00:00Z", "u1"),
        row("b", "/jobs?location=pune", "2026-01-02T00:00:00Z", "u2"),
      ],
      canonicalize,
      { existingKeys: new Map([["u1", new Set([key])]]) },
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["b"]);
    expect(plan.deletes).toEqual([{ id: "a", why: "duplicate" }]);
  });

  it("gives a salary filter the profile currency, or drops the salary", async () => {
    const plan = await planBackfill(
      [
        row("a", "/jobs?minSalary=100&location=pune", undefined, "u1"),
        row("b", "/jobs?minSalary=100&location=goa", undefined, "u2"),
      ],
      canonicalize,
      { currencies: new Map([["u1", "INR"]]) },
    );
    expect(plan.updates.find((u) => u.id === "a")!.filters).toEqual({
      location: ["pune"],
      minSalary: 100,
      salaryCurrency: "INR",
    });
    expect(plan.updates.find((u) => u.id === "b")!.filters).toEqual({ location: ["goa"] });
  });

  it("counts", async () => {
    const rows = [
      row("a", "/jobs?location=pune"),
      row("b", "/jobs?location=pune", "2026-02-01T00:00:00Z"),
      row("c", "/jobs"),
    ];
    expect(backfillCounts(rows.length, await planBackfill(rows, canonicalize))).toEqual({
      rows: 3,
      update: 1,
      deleteNotAlertable: 1,
      deleteDuplicate: 1,
    });
  });
});
