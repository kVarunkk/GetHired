import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSchedulingToken, newSchedulingLink, newSchedulingToken, schedulingUrl } from "./scheduling-token";

vi.mock("server-only", () => ({}));

describe("self-scheduling tokens (IVT-061, IV-SEC-003)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is 32 random bytes, URL-safe", () => {
    const token = newSchedulingToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(newSchedulingToken()).not.toBe(token);
  });

  it("hashes like scheduling_token_hash: sha256 of the UTF-8 token, in hex", () => {
    expect(hashSchedulingToken("abc")).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
    expect(hashSchedulingToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds the /schedule link and hands back only the hash for storage", () => {
    const link = newSchedulingLink();
    expect(link.url).toBe(schedulingUrl(link.token));
    expect(link.url).toMatch(/\/schedule\/[\w-]{43}$/);
    expect(link.hash).toBe(hashSchedulingToken(link.token));
    expect(link.hash).not.toContain(link.token);
  });

  it("never logs the token", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const link = newSchedulingLink();
    hashSchedulingToken(link.token);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
