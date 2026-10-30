/**
 * /api/mcp token checks (MCP TASK-030, MCP-SEC-001/007). Tokens are signed by a
 * local key set that a stubbed fetch serves as Supabase's JWKS.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { unauthorized, verifyMcpToken } from "./auth";
import { mcpResourceMetadataUrl } from "./config";

const SUPABASE_URL = "https://project.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const KID = "test-key";

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: { keys: unknown[] };

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("ES256")).privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256", use: "sig" }] };
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) =>
      String(url) === JWKS_URL
        ? Response.json(jwks)
        : new Response("not found", { status: 404 }),
    ),
  );
});

type Claims = Record<string, unknown>;

const token = ({
  claims = {},
  issuer = ISSUER,
  audience = "authenticated",
  expires = "1h",
  key = privateKey,
}: {
  claims?: Claims;
  issuer?: string;
  audience?: string;
  expires?: string | number;
  key?: CryptoKey;
} = {}) =>
  new SignJWT({ client_id: "client-1", role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setSubject("user-1")
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);

const request = (headers: Record<string, string> = {}, query = "") =>
  new Request(`https://gethired.devhub.co.in/api/mcp${query}`, { method: "POST", headers });

const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

async function expectRefused(result: Awaited<ReturnType<typeof verifyMcpToken>>, invalidToken: boolean) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.response.status).toBe(401);
  expect(result.response.headers.get("WWW-Authenticate")).toBe(
    invalidToken
      ? `Bearer error="invalid_token", resource_metadata="${mcpResourceMetadataUrl()}"`
      : `Bearer resource_metadata="${mcpResourceMetadataUrl()}"`,
  );
}

describe("verifyMcpToken", () => {
  it("accepts a Supabase OAuth token and returns its claims", async () => {
    const value = await token();

    const result = await verifyMcpToken(request(bearer(value)));

    expect(result).toMatchObject({
      ok: true,
      token: value,
      claims: { sub: "user-1", client_id: "client-1", aud: "authenticated", iss: ISSUER },
    });
  });

  it("refuses a browser session token, which has no client_id", async () => {
    await expectRefused(await verifyMcpToken(request(bearer(await token({ claims: { client_id: undefined } })))), true);
  });

  it("refuses an empty client_id", async () => {
    await expectRefused(await verifyMcpToken(request(bearer(await token({ claims: { client_id: "" } })))), true);
  });

  it("refuses another issuer", async () => {
    await expectRefused(
      await verifyMcpToken(request(bearer(await token({ issuer: "https://evil.example/auth/v1" })))),
      true,
    );
  });

  it("refuses another audience", async () => {
    await expectRefused(await verifyMcpToken(request(bearer(await token({ audience: "something-else" })))), true);
  });

  it("refuses an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    await expectRefused(await verifyMcpToken(request(bearer(await token({ expires: past })))), true);
  });

  it("refuses a token signed by another key", async () => {
    await expectRefused(await verifyMcpToken(request(bearer(await token({ key: otherKey })))), true);
  });

  it("refuses a malformed token", async () => {
    await expectRefused(await verifyMcpToken(request(bearer("not.a.jwt"))), true);
  });

  it("refuses a gh_ key", async () => {
    await expectRefused(await verifyMcpToken(request(bearer("gh_abc123"))), true);
  });

  it("asks for a token when there's no Authorization header", async () => {
    await expectRefused(await verifyMcpToken(request()), false);
  });

  it("asks for a token when the header isn't a bearer", async () => {
    await expectRefused(await verifyMcpToken(request({ Authorization: `Basic ${btoa("a:b")}` })), false);
  });

  it("ignores a token in the query string", async () => {
    const value = await token();

    await expectRefused(await verifyMcpToken(request({}, `?access_token=${value}`)), false);
  });
});

describe("unauthorized", () => {
  it("points the client at the protected resource metadata (MCP-SEC-007)", async () => {
    const response = unauthorized();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${mcpResourceMetadataUrl()}"`,
    );
    expect(mcpResourceMetadataUrl()).toMatch(/\/\.well-known\/oauth-protected-resource\/api\/mcp$/);
    expect(await response.json()).toEqual({ error: "Sign in to GetHired to use this server." });
  });
});
