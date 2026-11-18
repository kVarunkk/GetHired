import { describe, expect, it } from "vitest";
import { readSourceTag, sourceTagQuery } from "./source-tag";

const p = (q: string) => new URLSearchParams(q);

describe("readSourceTag (MP-REQ-005/006)", () => {
  it("reads a known channel and the posting id", () => {
    expect(readSourceTag(p("src=jooble&pid=abc-123"))).toEqual({ channel: "jooble", pid: "abc-123" });
  });
  it("is case-insensitive", () => {
    expect(readSourceTag(p("src=Indeed"))).toEqual({ channel: "indeed", pid: null });
  });
  it("stores an unknown but well-formed tag as other", () => {
    expect(readSourceTag(p("src=somenewboard"))).toEqual({ channel: "other", pid: null });
  });
  it("treats an unsafe tag as other and drops an unsafe pid", () => {
    expect(readSourceTag(p("src=<script>&pid=a b"))).toEqual({ channel: "other", pid: null });
  });
  it("returns null with no tag (an application from GetHired itself)", () => {
    expect(readSourceTag(p(""))).toBeNull();
    expect(readSourceTag(p("pid=abc"))).toBeNull();
  });
});

describe("sourceTagQuery", () => {
  it("rebuilds the query so the tag survives the sign-up round trip", () => {
    expect(sourceTagQuery({ channel: "jooble", pid: "p1" })).toBe("src=jooble&pid=p1");
    expect(sourceTagQuery({ channel: "talent", pid: null })).toBe("src=talent");
    expect(sourceTagQuery(null)).toBe("");
  });
});
