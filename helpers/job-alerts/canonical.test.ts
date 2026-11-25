import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));

import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { canonicalAlert, canonicalAlertFilters } from "./canonical";
import { alertFiltersFromSearchParams, alertSearchString, filtersKey } from "./filters";

const ALIASES: Record<string, string> = { bangalore: "Bengaluru", bengaluru: "Bengaluru", blr: "Bengaluru" };

beforeEach(() => {
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) => {
    const out: string[] = [];
    for (const name of names) {
      const canonical = ALIASES[name.toLowerCase()] ?? name;
      if (!out.some((n) => n.toLowerCase() === canonical.toLowerCase())) out.push(canonical);
    }
    return out;
  });
});

describe("canonicalAlertFilters (JAT-014)", () => {
  it("gives bengaluru and bangalore one key", async () => {
    const a = await canonicalAlert(alertFiltersFromSearchParams("location=bangalore|remote")!);
    const b = await canonicalAlert(alertFiltersFromSearchParams("location=Remote|Bengaluru")!);
    expect(a.key).toBe(b.key);
    expect(a.filters.location).toEqual(["bengaluru", "remote"]);
  });

  it("merges two spellings of one place", async () => {
    expect((await canonicalAlertFilters({ location: ["blr", "bangalore"] })).location).toEqual(["bengaluru"]);
  });

  it("leaves filters without locations alone", async () => {
    const filters = { jobTitleKeywords: ["react"] };
    expect(await canonicalAlertFilters(filters)).toBe(filters);
    expect(canonicalizeLocations).not.toHaveBeenCalled();
  });

  it("is stable across key order", () => {
    expect(filtersKey({ location: ["pune"], jobTitleKeywords: ["react"] })).toBe(
      filtersKey({ jobTitleKeywords: ["react"], location: ["pune"] }),
    );
  });

  it("round-trips through the stored url", async () => {
    const first = await canonicalAlert(alertFiltersFromSearchParams("location=Bangalore&minSalary=10&salaryCurrency=INR")!);
    const again = await canonicalAlert(alertFiltersFromSearchParams(alertSearchString(first.filters))!);
    expect(again.key).toBe(first.key);
  });
});
