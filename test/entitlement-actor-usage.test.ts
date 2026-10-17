import { describe, expect, it } from "vitest";
import { callsOf, readSource, sourceFiles, topLevelArgs } from "@/test/utils/source";

// RP-REQ-043 / RPT-061: usage is charged to the session user who started it,
// so per-member caps hold. Only work the system starts itself may pass a
// `null` actor, and each such path is listed here with its reason.
const ACTOR_ARG = { consumeEntitlement: 4, holdEntitlement: 4, assertAllowance: 3 } as const;

const SYSTEM_PATHS: Record<string, string> = {
  "app/api/updates/company/match-explanations/worker/route.ts": "the weekly digest's explanations; no member asked",
};

function nullActorCalls(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const file of sourceFiles(["app", "helpers", "components", "lib"])) {
    if (file === "helpers/billing/entitlements.ts") continue;
    const source = readSource(file);
    for (const [name, index] of Object.entries(ACTOR_ARG)) {
      for (const args of callsOf(source, name)) {
        const actor = topLevelArgs(args)[index];
        if (actor === undefined || actor === "null" || actor === "undefined") {
          (found[file] ??= []).push(`${name}(${actor ?? "<missing>"})`);
        }
      }
    }
  }
  return found;
}

describe("entitlement actor usage", () => {
  it("every charge passes an actor, outside the system paths", () => {
    const offenders = Object.entries(nullActorCalls()).filter(([file]) => !(file in SYSTEM_PATHS));
    expect(offenders).toEqual([]);
  });

  it("the system-path allowlist has no stale entries", () => {
    const found = nullActorCalls();
    expect(Object.keys(SYSTEM_PATHS).filter((file) => !(file in found))).toEqual([]);
  });

  it("reads the actor argument across lines", () => {
    const source = `await consumeEntitlement(\n  id,\n  "outreach",\n  1,\n  { type: "x", id: f(a, b) },\n  null,\n);`;
    expect(topLevelArgs(callsOf(source, "consumeEntitlement")[0])[4]).toBe("null");
  });
});
