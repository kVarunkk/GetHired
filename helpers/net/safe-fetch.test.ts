import { describe, expect, it, vi } from "vitest";
import { createMemoryRateLimiter } from "./memory-rate-limit";
import { isPrivateAddress, parsePublicHttpsUrl, safeFetch, type LookupFn } from "./safe-fetch";

const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const lookupTo =
  (map: Record<string, string>): LookupFn =>
  async (host) => [{ address: map[host] ?? "93.184.216.34", family: map[host]?.includes(":") ? 6 : 4 }];

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe("parsePublicHttpsUrl", () => {
  it.each([
    "http://example.com/job",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://localhost/",
    "https://api.localhost/",
    "https://metadata.google.internal/",
    "https://intranet/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (url) => {
    expect(parsePublicHttpsUrl(url)).toBeNull();
  });

  it("accepts a public https link", () => {
    expect(parsePublicHttpsUrl("https://boards.greenhouse.io/acme/jobs/1")?.hostname).toBe("boards.greenhouse.io");
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "garbage",
  ])("%s is private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("safeFetch", () => {
  it("reads a normal page", async () => {
    const fetchFn = vi.fn(async () => html("<title>Engineer</title>"));
    const result = await safeFetch("https://jobs.example.com/1", { lookup: publicLookup, fetch: fetchFn as typeof fetch });
    expect(result).toMatchObject({ ok: true, body: "<title>Engineer</title>", contentType: "text/html" });
    expect(fetchFn).toHaveBeenCalledWith("https://jobs.example.com/1", expect.objectContaining({ redirect: "manual" }));
  });

  it.each([
    ["10.0.0.5"],
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["fc00::2"],
  ])("refuses a host that resolves to %s, without fetching", async (address) => {
    const fetchFn = vi.fn();
    const result = await safeFetch("https://evil.example.com/", {
      lookup: lookupTo({ "evil.example.com": address }),
      fetch: fetchFn as never,
    });
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses when any one of the addresses is private", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    expect(await safeFetch("https://mixed.example.com/", { lookup, fetch: vi.fn() as never })).toMatchObject({
      reason: "blocked_host",
    });
  });

  it("refuses a host that doesn't resolve", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await safeFetch("https://nope.example.com/", { lookup, fetch: vi.fn() as never })).toMatchObject({
      reason: "blocked_host",
    });
  });

  it("refuses IP literals and non-https links before any lookup", async () => {
    const lookup = vi.fn(publicLookup);
    for (const url of ["https://8.8.8.8/", "http://example.com/", "https://[2606:4700::1111]/"]) {
      expect(await safeFetch(url, { lookup, fetch: vi.fn() as never })).toEqual({ ok: false, reason: "invalid_url" });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("follows a redirect to a public host, checking it again", async () => {
    const lookup = vi.fn(publicLookup);
    const fetchFn = vi.fn().mockResolvedValueOnce(redirect("https://b.example.com/job")).mockResolvedValueOnce(html("ok"));
    const result = await safeFetch("https://a.example.com/", { lookup, fetch: fetchFn });
    expect(result).toMatchObject({ ok: true, url: "https://b.example.com/job" });
    expect(lookup).toHaveBeenCalledWith("b.example.com");
  });

  it("refuses a redirect to a private host", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(redirect("https://inside.example.com/"));
    const result = await safeFetch("https://a.example.com/", {
      lookup: lookupTo({ "inside.example.com": "192.168.0.10" }),
      fetch: fetchFn,
    });
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to an IP literal or http", async () => {
    for (const location of ["https://127.0.0.1/", "http://b.example.com/"]) {
      const fetchFn = vi.fn().mockResolvedValueOnce(redirect(location));
      expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: fetchFn })).toEqual({
        ok: false,
        reason: "blocked_host",
      });
    }
  });

  it("stops at the 4th redirect", async () => {
    const fetchFn = vi.fn(async () => redirect("https://a.example.com/next"));
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: fetchFn as never })).toEqual({
      ok: false,
      reason: "too_many_redirects",
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("refuses a page that isn't HTML", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: fetchFn as never })).toEqual({
      ok: false,
      reason: "bad_content_type",
    });
  });

  it("refuses a body over the cap, declared or streamed", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const streamed = vi.fn(async () => html(big));
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: streamed as never })).toEqual({
      ok: false,
      reason: "too_large",
    });
    const declared = vi.fn(async () =>
      html("small", { headers: { "content-type": "text/html", "content-length": String(5 * 1024 * 1024) } }),
    );
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: declared as never })).toMatchObject({
      reason: "too_large",
    });
  });

  it("reports an error status", async () => {
    const fetchFn = vi.fn(async () => html("blocked", { status: 403 }));
    expect(await safeFetch("https://www.linkedin.com/jobs/view/1", { lookup: publicLookup, fetch: fetchFn as never })).toEqual({
      ok: false,
      reason: "bad_status",
      status: 403,
    });
  });

  it("reports a timeout and a network error without throwing", async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: timeout as never })).toEqual({
      ok: false,
      reason: "timeout",
    });
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await safeFetch("https://a.example.com/", { lookup: publicLookup, fetch: network as never })).toEqual({
      ok: false,
      reason: "network",
    });
  });
});

describe("createMemoryRateLimiter", () => {
  it("allows up to the limit in the window, per key, and frees up as hits age out", () => {
    let time = 0;
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 1000, now: () => time });

    expect(limiter.hit("a")).toEqual({ allowed: true, remaining: 1 });
    time = 100;
    expect(limiter.hit("a")).toEqual({ allowed: true, remaining: 0 });
    time = 500;
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterMs: 500 });
    expect(limiter.hit("b")).toMatchObject({ allowed: true });

    time = 1000;
    expect(limiter.hit("a")).toMatchObject({ allowed: true });
    time = 1050;
    expect(limiter.hit("a")).toMatchObject({ allowed: false });
  });

  it("drops the oldest keys past maxKeys", () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 1000, now: () => 0, maxKeys: 2 });
    limiter.hit("a");
    limiter.hit("b");
    limiter.hit("c");
    expect(limiter.hit("a")).toMatchObject({ allowed: true });
    expect(limiter.hit("c")).toMatchObject({ allowed: false });
  });
});
