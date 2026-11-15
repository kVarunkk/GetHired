import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken, type TokenBinding } from "./token-crypto";

const KEY_1 = randomBytes(32).toString("base64");
const KEY_2 = randomBytes(32).toString("base64");

const binding: TokenBinding = {
  connectionId: "ca000000-0000-4000-8000-000000000001",
  userId: "c2000000-0000-4000-8000-000000000001",
  kind: "refresh",
};

function useKeys(keys: Record<string, string>, current: string) {
  vi.stubEnv("CALENDAR_TOKEN_KEYS", JSON.stringify(keys));
  vi.stubEnv("CALENDAR_TOKEN_KEY_CURRENT", current);
}

beforeEach(() => useKeys({ "1": KEY_1 }, "1"));
afterEach(() => vi.unstubAllEnvs());

describe("calendar token crypto (IV-SEC-001)", () => {
  it("round-trips a token and reports the key version", () => {
    const sealed = encryptToken("1//refresh-token", binding);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.value).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(sealed.value).not.toContain("refresh-token");
    expect(decryptToken(sealed.value, binding)).toBe("1//refresh-token");
  });

  it("uses a fresh 12-byte IV every call", () => {
    const a = encryptToken("same", binding).value;
    const b = encryptToken("same", binding).value;
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(":")[1], "base64")).toHaveLength(12);
  });

  it.each([
    ["another connection", { ...binding, connectionId: "ca000000-0000-4000-8000-000000000002" }],
    ["another user", { ...binding, userId: "c3000000-0000-4000-8000-000000000001" }],
    ["the other kind", { ...binding, kind: "access" as const }],
  ])("refuses a ciphertext bound to %s", (_label, other) => {
    const sealed = encryptToken("secret", binding).value;
    expect(() => decryptToken(sealed, other)).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const [v, iv, ct] = encryptToken("secret", binding).value.split(":");
    const bytes = Buffer.from(ct, "base64");
    bytes[0] ^= 1;
    expect(() => decryptToken(`${v}:${iv}:${bytes.toString("base64")}`, binding)).toThrow();
  });

  it("refuses a malformed value", () => {
    expect(() => decryptToken("not-a-token", binding)).toThrow();
    expect(() => decryptToken("v9:aaaa:bbbb", binding)).toThrow(/key version 9/);
  });

  it("decrypts a v1 value after v2 becomes current, and writes new values with v2", () => {
    const old = encryptToken("old", binding).value;
    useKeys({ "1": KEY_1, "2": KEY_2 }, "2");
    expect(decryptToken(old, binding)).toBe("old");
    const fresh = encryptToken("new", binding);
    expect(fresh.keyVersion).toBe(2);
    expect(fresh.value.startsWith("v2:")).toBe(true);
  });

  it("throws without logging the key or the token when a key is missing", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useKeys({ "1": KEY_1 }, "3");
    let message = "";
    try {
      encryptToken("1//do-not-log", binding);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/CALENDAR_TOKEN_KEY/);
    expect(message).not.toContain("do-not-log");
    expect(message).not.toContain(KEY_1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a key that isn't 32 bytes", () => {
    useKeys({ "1": randomBytes(16).toString("base64") }, "1");
    expect(() => encryptToken("x", binding)).toThrow(/32 bytes/);
  });
});
