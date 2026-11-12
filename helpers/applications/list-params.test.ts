import { describe, expect, it } from "vitest";
import {
  APPLICATIONS_PATH,
  applicationListHref,
  escapeLike,
  parseApplicationListParams,
  type ApplicationListParams,
} from "./list-params";

const JOB = "b0000000-0000-4000-8000-000000000001";

describe("parseApplicationListParams (QF-REQ-022)", () => {
  it("defaults to everything, newest first, page 1", () => {
    expect(parseApplicationListParams({})).toEqual({
      q: null,
      job: null,
      status: null,
      recommendation: null,
      knockout: null,
      sort: "created_at",
      dir: "desc",
      page: 1,
    });
  });

  it("reads every filter", () => {
    expect(
      parseApplicationListParams({
        q: "ada",
        job: JOB,
        status: "rejected",
        recommendation: "strong_yes",
        knockout: "failed",
        sort: "fit_score",
        dir: "asc",
        page: "3",
      }),
    ).toEqual({
      q: "ada",
      job: JOB,
      status: "rejected",
      recommendation: "strong_yes",
      knockout: "failed",
      sort: "fit_score",
      dir: "asc",
      page: 3,
    });
  });

  it("trims the name and cuts it to 100 characters", () => {
    expect(parseApplicationListParams({ q: "  Ada Lovelace  " }).q).toBe("Ada Lovelace");
    expect(parseApplicationListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
    expect(parseApplicationListParams({ q: "   " }).q).toBeNull();
  });

  it.each([
    ["status", { status: "hired" }],
    ["recommendation", { recommendation: "definitely" }],
    ["knockout", { knockout: "none" }],
    ["job", { job: "not-a-uuid" }],
  ])("ignores an unknown %s", (key, params) => {
    expect(parseApplicationListParams(params)[key as keyof ApplicationListParams]).toBeNull();
  });

  it("falls back to the default sort and direction", () => {
    expect(parseApplicationListParams({ sort: "email", dir: "sideways" })).toMatchObject({
      sort: "created_at",
      dir: "desc",
    });
  });

  it("sorts names A–Z and scores and dates highest first by default", () => {
    expect(parseApplicationListParams({ sort: "person_name" }).dir).toBe("asc");
    expect(parseApplicationListParams({ sort: "status" }).dir).toBe("asc");
    expect(parseApplicationListParams({ sort: "fit_score" }).dir).toBe("desc");
    expect(parseApplicationListParams({ sort: "person_name", dir: "desc" }).dir).toBe("desc");
  });

  it.each(["0", "-2", "abc", "1.5x", ""])("reads page %j as 1", (page) => {
    expect(parseApplicationListParams({ page }).page).toBe(1);
  });

  it("takes the first value of a repeated param", () => {
    expect(parseApplicationListParams({ status: ["rejected", "reviewed"] }).status).toBe("rejected");
  });
});

describe("escapeLike", () => {
  it("escapes the ilike wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("drops PostgREST's * wildcard", () => {
    expect(escapeLike("a*b")).toBe("ab");
  });
});

describe("applicationListHref (QF-REQ-024)", () => {
  const base = parseApplicationListParams({ q: "ada", status: "rejected", page: "3" });

  it("resets the page when a filter changes", () => {
    expect(applicationListHref(base, { status: "reviewed" })).toBe(
      `${APPLICATIONS_PATH}?q=ada&status=reviewed`,
    );
  });

  it("keeps the filters when only the page changes", () => {
    expect(applicationListHref(base, { page: 4 })).toBe(`${APPLICATIONS_PATH}?q=ada&status=rejected&page=4`);
  });

  it("drops empty values and defaults", () => {
    expect(applicationListHref(base, { q: null, status: null })).toBe(APPLICATIONS_PATH);
    expect(applicationListHref(parseApplicationListParams({}), { sort: "created_at", dir: "desc" })).toBe(
      APPLICATIONS_PATH,
    );
  });

  it("writes a sort and a non-default direction", () => {
    expect(applicationListHref(parseApplicationListParams({}), { sort: "person_name", dir: "desc" })).toBe(
      `${APPLICATIONS_PATH}?sort=person_name&dir=desc`,
    );
    expect(applicationListHref(parseApplicationListParams({}), { sort: "fit_score", dir: "desc" })).toBe(
      `${APPLICATIONS_PATH}?sort=fit_score`,
    );
  });
});
