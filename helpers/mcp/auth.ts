/**
 * Who is calling /api/mcp (MCP spec §4.3). Only a Supabase OAuth access token
 * in the Authorization header gets through: signed by the project's keys,
 * issued by its auth server for `authenticated`, and carrying `client_id`,
 * which only tokens from the OAuth server have (MCP-SEC-001/002).
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { Database } from "@/utils/types/database.types";
import { MCP_TOKEN_AUDIENCE, mcpResourceMetadataUrl, supabaseIssuer } from "./config";

export type McpTokenClaims = JWTPayload & { sub: string; client_id: string; exp: number };

export type McpTokenResult =
  | { ok: true; token: string; claims: McpTokenClaims }
  | { ok: false; response: Response };

// One key set per issuer, so jose's key cache outlives a request.
let jwks: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;

function keysFor(issuer: string) {
  if (jwks?.issuer !== issuer) {
    jwks = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
  }
  return jwks.keys;
}

/**
 * The 401 that starts a client's OAuth flow: WWW-Authenticate points at the
 * protected resource metadata (MCP-SEC-007). `invalidToken` adds RFC 6750's
 * error code when a token was sent but refused.
 */
export function unauthorized({ invalidToken = false }: { invalidToken?: boolean } = {}) {
  const params = [`resource_metadata="${mcpResourceMetadataUrl()}"`];
  if (invalidToken) params.unshift(`error="invalid_token"`);
  return Response.json(
    { error: invalidToken ? "Your GetHired sign-in has expired or isn't valid. Sign in again." : "Sign in to GetHired to use this server." },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

/** Reads the token from the Authorization header only; a query-string token is ignored. */
export async function verifyMcpToken(request: Request): Promise<McpTokenResult> {
  const header = request.headers.get("Authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, response: unauthorized() };
  const token = match[1];

  const issuer = supabaseIssuer();
  try {
    const { payload } = await jwtVerify(token, keysFor(issuer), {
      issuer,
      audience: MCP_TOKEN_AUDIENCE,
      requiredClaims: ["sub", "exp"],
    });
    if (typeof payload.client_id !== "string" || !payload.client_id) {
      return { ok: false, response: unauthorized({ invalidToken: true }) };
    }
    return { ok: true, token, claims: payload as McpTokenClaims };
  } catch {
    return { ok: false, response: unauthorized({ invalidToken: true }) };
  }
}

/**
 * A user-scoped client for the token's user (MCP-SEC-003): the anon key plus
 * the bearer, so RLS applies. No cookies and no session of its own.
 */
export function createMcpSupabaseClient(token: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}
