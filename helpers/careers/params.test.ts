import { describe, expect, it } from "vitest";
import { readRef, toSearchParams } from "./params";

describe("careers params", () => {
  it("keeps repeated keys", () => {
    expect(toSearchParams({ department: ["Design", "Engineering"], q: "go", x: undefined }).toString()).toBe(
      "department=Design&department=Engineering&q=go",
    );
  });

  it("reads a safe ref tag (CP-REQ-013)", () => {
    expect(readRef(new URLSearchParams("ref=LinkedIn"))).toBe("linkedin");
    expect(readRef(new URLSearchParams("ref=<script>"))).toBeNull();
    expect(readRef(new URLSearchParams(""))).toBeNull();
  });
});
