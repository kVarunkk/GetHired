import { afterEach, describe, expect, it, vi } from "vitest";

const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const OTHER = "cc000000-0000-4000-8000-000000000002";

async function load(secret: string) {
  vi.resetModules();
  vi.doMock("@/utils/formatters", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/formatters")>()),
    INTERNAL_API_SECRET: secret,
  }));
  return import("./unsubscribe-token");
}

afterEach(() => vi.doUnmock("@/utils/formatters"));

describe("candidate unsubscribe tokens (BIT-060, BI-REQ-034)", () => {
  it("signs a token naming the candidate and reads it back", async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } = await load("s3cret");
    const token = signUnsubscribeToken(CANDIDATE);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(verifyUnsubscribeToken(token)).toBe(CANDIDATE);
    expect(unsubscribeUrl(CANDIDATE)).toBe(`http://localhost:3000/unsubscribe/candidate/${token}`);
  });

  it("refuses a tampered token, another candidate's signature and malformed input", async () => {
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await load("s3cret");
    const token = signUnsubscribeToken(CANDIDATE);
    const [, sig] = token.split(".");
    const other = signUnsubscribeToken(OTHER);
    expect(verifyUnsubscribeToken(`${other.split(".")[0]}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${token.slice(0, -2)}xx`)).toBeNull();
    for (const bad of ["", "abc", "a.b.c", `${CANDIDATE}.`, ".x", "not-a-uuid.sig"]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });

  it("refuses a token signed with another secret", async () => {
    const token = (await load("old-secret")).signUnsubscribeToken(CANDIDATE);
    expect((await load("new-secret")).verifyUnsubscribeToken(token)).toBeNull();
  });

  it("never signs or accepts anything without a secret", async () => {
    const withSecret = (await load("s3cret")).signUnsubscribeToken(CANDIDATE);
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await load("");
    expect(() => signUnsubscribeToken(CANDIDATE)).toThrow();
    expect(verifyUnsubscribeToken(withSecret)).toBeNull();
  });
});
