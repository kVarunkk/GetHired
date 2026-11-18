import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { jobPageUrl, pingGoogleIndexing, pingIndexNow } from "./index-ping";

const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe("pingIndexNow", () => {
  it("is skipped without a key", async () => {
    const fetchImpl = vi.fn();
    expect(await pingIndexNow(["https://x/jobs/1"], { key: "", fetchImpl })).toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the url list with the key location", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(202));
    const out = await pingIndexNow([jobPageUrl("j1")], { key: "k", fetchImpl });
    expect(out.ok).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ key: "k", urlList: [jobPageUrl("j1")] });
    expect(body.keyLocation).toMatch(/\/indexnow-key$/);
  });

  it("fails on 429 and on a network error", async () => {
    expect((await pingIndexNow(["u"], { key: "k", fetchImpl: vi.fn().mockResolvedValue(res(429)) })).ok).toBe(false);
    expect((await pingIndexNow(["u"], { key: "k", fetchImpl: vi.fn().mockRejectedValue(new Error("down")) })).ok).toBe(false);
  });
});

describe("pingGoogleIndexing", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const serviceAccount = JSON.stringify({ client_email: "svc@x.iam", private_key: privateKey });

  it("is skipped without or with a malformed service account", async () => {
    const fetchImpl = vi.fn();
    expect((await pingGoogleIndexing("u", "URL_UPDATED", { serviceAccount: undefined, fetchImpl })).skipped).toBe(true);
    expect((await pingGoogleIndexing("u", "URL_UPDATED", { serviceAccount: "{bad", fetchImpl })).skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exchanges a signed JWT, then publishes the notification", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(200, { access_token: "tok" }))
      .mockResolvedValueOnce(res(200));
    const out = await pingGoogleIndexing("https://x/jobs/1", "URL_DELETED", { serviceAccount, fetchImpl, now: () => 1000 });
    expect(out.ok).toBe(true);
    const assertion = (fetchImpl.mock.calls[0][1].body as URLSearchParams).get("assertion")!;
    expect(assertion.split(".")).toHaveLength(3);
    const publish = fetchImpl.mock.calls[1];
    expect(publish[1].headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(publish[1].body)).toEqual({ url: "https://x/jobs/1", type: "URL_DELETED" });
  });

  it("fails when the token request fails", async () => {
    const out = await pingGoogleIndexing("u", "URL_UPDATED", { serviceAccount, fetchImpl: vi.fn().mockResolvedValue(res(401)) });
    expect(out.ok).toBe(false);
  });
});
