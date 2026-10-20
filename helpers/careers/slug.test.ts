import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, slugify, validateSlug } from "./slug";

describe("careers slugs (CP-REQ-001)", () => {
  it.each([["acme"], ["acme-inc"], ["a1b"], ["x".repeat(40)]])("accepts %s", (slug) => {
    expect(validateSlug(slug)).toEqual({ ok: true, slug });
  });

  it("lowercases and trims", () => {
    expect(validateSlug("  Acme-Inc ")).toEqual({ ok: true, slug: "acme-inc" });
  });

  it.each([
    ["ab", "Use 3 to 40 characters."],
    ["x".repeat(41), "Use 3 to 40 characters."],
    ["acme inc", "Use lowercase letters, numbers and single dashes."],
    ["-acme", "Use lowercase letters, numbers and single dashes."],
    ["acme--inc", "Use lowercase letters, numbers and single dashes."],
    ["jobs", "That address is reserved."],
  ])("rejects %s", (slug, error) => {
    expect(validateSlug(slug)).toEqual({ ok: false, error });
  });

  it("slugifies company names like the database", () => {
    expect(slugify("Acme, Inc.")).toBe("acme-inc");
    expect(slugify("X")).toBe("x-jobs");
    expect(slugify("  ")).toBe("company");
    expect(slugify("Über Café")).toBe("ber-caf");
  });

  it("reserves the same words as the migration", () => {
    const sql = readFileSync("supabase/migrations/20261017230000_careers_page.sql", "utf8");
    const block = sql.slice(sql.indexOf("p_slug <> all (array["), sql.indexOf("])", sql.indexOf("p_slug <> all (array[")));
    const words = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(words).toEqual([...RESERVED_SLUGS].sort());
  });
});
