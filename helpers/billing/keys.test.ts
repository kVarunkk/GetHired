import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWANCE_KEYS, ENTITLEMENT_KEYS, KEY_LABELS, kindOf, labelFor } from "./keys";
import { SHOWN_KEYS } from "./plan-lines";
import { ENTITLEMENT_KEYS as FIXTURE_KEYS } from "@/test/utils/billing";

describe("entitlement keys", () => {
  it("match the test fixtures", () => {
    expect([...ENTITLEMENT_KEYS].sort()).toEqual([...FIXTURE_KEYS].sort());
  });

  it("label every key", () => {
    for (const key of ENTITLEMENT_KEYS) {
      expect(KEY_LABELS[key].one, key).toBeTruthy();
      expect(KEY_LABELS[key].many, key).toBeTruthy();
    }
  });
});

describe("resume_imports (BI-REQ-021)", () => {
  it("is an allowance with its labels", () => {
    expect(ALLOWANCE_KEYS).toContain("resume_imports");
    expect(kindOf("resume_imports")).toBe("allowance");
    expect(labelFor("resume_imports", 1)).toBe("resume import");
    expect(labelFor("resume_imports", 3)).toBe("resume imports");
  });

  it("is listed on the pricing page", () => {
    expect(SHOWN_KEYS).toContain("resume_imports");
  });

  it("is accepted by the database's key checks", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261025120000_bulk_import.sql"),
      "utf8",
    );
    expect(sql).toMatch(/tier_entitlements_key_check[\s\S]*'resume_imports'/);
    expect(sql).toMatch(/billing_assert_key[\s\S]*'resume_imports'/);
    expect(sql).toMatch(/get_company_entitlements[\s\S]*'resume_imports'/);
  });
});
