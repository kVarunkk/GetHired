/**
 * Confirmation for the tools the agent always asks about (MCP spec §4.6,
 * MCP-REQ-006, MCP-SEC-011). Both paths show the user a preview first and
 * run the tool only after a yes:
 *
 * - A. MRTR elicitation, for 2026 clients that declare it. The client asks
 *   the user and retries with their answer and our signed requestState.
 * - B. A two-step fallback for everyone else. The first call stores the
 *   confirmation in mcp_confirmations and returns the preview and a short
 *   confirmation_token, which the model sends back with the same input once
 *   the user has said yes. It's short because the model copies it by hand,
 *   and models mis-copied the old ~200-character signed token.
 *
 * Both bind the user, the tool, the path and a digest of the input, expire
 * after MCP_CONFIRMATION_TTL_SECONDS and are used up in mcp_confirmations
 * right before the run, so each one works once.
 */
import "server-only";
import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  CLIENT_CAPABILITIES_META_KEY,
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  type CallToolResult,
  type RequestStateCodec,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { reportError } from "@/helpers/posthog/report-error";
import { deploymentUrl } from "@/utils/formatters";
import { MCP_CONFIRMATION_TTL_SECONDS } from "./config";
import { withOutcome, type McpRunResult } from "./limits";
import { previewText, type McpPreview } from "./previews";
import { jsonResult, messageResult, textResult } from "./results";
import { CONFIRMATION_TOKEN_KEY } from "./schema";

export type ConfirmationBinding = {
  userId: string;
  /** The MCP tool name. */
  tool: string;
  /** Which path minted it, so a path A state can't stand in for a path B token. */
  via: "elicit" | "token";
};

type Claims = { jti: string; digest: string };

export type VerifiedConfirmation =
  | { ok: true; jti: string }
  | { ok: false; reason: "invalid" | "expired" | "mismatch" };

/** The HMAC key; the SDK's codec needs at least 32 bytes. */
const MIN_SECRET_BYTES = 32;

let cachedCodec: { key: string; codec: RequestStateCodec<Claims> } | null = null;

function codec(): RequestStateCodec<Claims> | null {
  const key = process.env.MCP_STATE_SECRET ?? "";
  if (Buffer.byteLength(key) < MIN_SECRET_BYTES) return null;
  if (cachedCodec?.key !== key) {
    cachedCodec = {
      key,
      codec: createRequestStateCodec<Claims>({ key, ttlSeconds: MCP_CONFIRMATION_TTL_SECONDS }),
    };
  }
  return cachedCodec.codec;
}

function requireCodec() {
  const found = codec();
  if (!found) throw new Error("MCP_STATE_SECRET is missing or shorter than 32 bytes.");
  return found;
}

/** JSON with sorted keys, so the same input always digests the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Binds the input to the user, the tool and the path. The digest is all the
 * wire value carries of them, so the user id isn't readable in it.
 */
export function confirmationDigest(binding: ConfirmationBinding, input: unknown) {
  return createHash("sha256")
    .update(canonicalJson({ user: binding.userId, tool: binding.tool, via: binding.via, input }))
    .digest("base64url");
}

export function mintConfirmation(binding: ConfirmationBinding, input: unknown): Promise<string> {
  return requireCodec().mint({ jti: randomUUID(), digest: confirmationDigest(binding, input) });
}

export async function verifyConfirmation(
  state: string,
  binding: ConfirmationBinding,
  input: unknown,
): Promise<VerifiedConfirmation> {
  let claims: Claims;
  try {
    // The codec's verify ignores its context when there's no bind callback.
    claims = await requireCodec().verify(state, undefined as unknown as ServerContext);
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.message === "expired" ? "expired" : "invalid" };
  }
  if (typeof claims?.jti !== "string" || claims.digest !== confirmationDigest(binding, input)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, jti: claims.jti };
}

/** Path B's token: no 0/o or 1/l/i, so it's hard to misread. About 49 bits. */
const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 10;
const TOKEN_PATTERN = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

export type TokenClaim = "claimed" | "invalid" | "expired" | "mismatch" | "used";
const TOKEN_CLAIMS: readonly string[] = ["claimed", "invalid", "expired", "mismatch", "used"];

/** Stores an unused path B confirmation for this input and returns its token. */
export async function issueConfirmationToken(
  supabase: SupabaseClient<Database>,
  binding: ConfirmationBinding,
  input: unknown,
): Promise<string> {
  const token = Array.from({ length: TOKEN_LENGTH }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join("");
  const { error } = await supabase.from("mcp_confirmations").insert({
    jti: randomUUID(),
    code: token,
    digest: confirmationDigest(binding, input),
    user_id: binding.userId,
    tool: binding.tool,
    used_at: null,
    expires_at: new Date(Date.now() + MCP_CONFIRMATION_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw error;
  return token;
}

/**
 * Uses up a path B token if it's the session user's, unexpired, unused and
 * for this tool and input. Case and surrounding spaces are forgiven.
 */
export async function claimConfirmationToken(
  supabase: SupabaseClient<Database>,
  binding: ConfirmationBinding,
  input: unknown,
  token: string,
): Promise<TokenClaim> {
  const code = token.trim().toLowerCase();
  if (!TOKEN_PATTERN.test(code)) return "invalid";
  const { data, error } = await supabase.rpc("claim_mcp_confirmation", {
    p_code: code,
    p_digest: confirmationDigest(binding, input),
  });
  if (error) throw error;
  return typeof data === "string" && TOKEN_CLAIMS.includes(data) ? (data as TokenClaim) : "invalid";
}

/** Uses up a path A confirmation. "used" means it already ran once (the primary key). */
export async function claimConfirmation(
  supabase: SupabaseClient<Database>,
  { userId, tool, jti }: { userId: string; tool: string; jti: string },
): Promise<"claimed" | "used"> {
  const { error } = await supabase.from("mcp_confirmations").insert({
    jti,
    user_id: userId,
    tool,
    expires_at: new Date(Date.now() + MCP_CONFIRMATION_TTL_SECONDS * 1000).toISOString(),
  });
  if (!error) return "claimed";
  if (error.code === "23505") return "used";
  throw error;
}

/**
 * Whether the client can answer a form elicitation. Returning inputRequired
 * to one that can't is a hard -32021 error, so this comes first (§4.6 A).
 * 2025 clients have no envelope on the stateless legacy path, so they're
 * always path B.
 */
export function canElicit(request: ServerContext) {
  const envelope = request.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as
    | { elicitation?: { form?: unknown; url?: unknown } }
    | undefined;
  const elicitation = capabilities?.elicitation;
  if (!elicitation || typeof elicitation !== "object") return false;
  // An empty object means form mode; URL mode alone can't show a yes/no.
  return elicitation.form !== undefined || elicitation.url === undefined;
}

const CONFIRM_SCHEMA = {
  type: "object" as const,
  properties: { confirm: { type: "boolean" as const, title: "Confirm" } },
  required: ["confirm"],
};

const INSTRUCTION = `Show this preview to the user and ask them to confirm. Call this tool again with the same input and ${CONFIRMATION_TOKEN_KEY} only after they say yes.`;

const REFUSALS = {
  invalid: `That ${CONFIRMATION_TOKEN_KEY} wasn't recognized, so it may not have been copied exactly. Send the new one below unchanged.`,
  mismatch: `That ${CONFIRMATION_TOKEN_KEY} was for a different input, so this input needs its own confirmation.`,
  expired: `That ${CONFIRMATION_TOKEN_KEY} has expired.`,
  used: `That ${CONFIRMATION_TOKEN_KEY} was already used.`,
} as const;

export type ConfirmGate = {
  ctx: AgentToolContext;
  /** The MCP tool name. */
  tool: string;
  /** The validated arguments, which may include a confirmation_token. */
  args: Record<string, unknown>;
  /** The SDK's handler context: client capabilities and MRTR state. */
  request: ServerContext;
  preview: (input: Record<string, unknown>) => Promise<McpPreview>;
  run: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

/** Shows the preview and runs the tool only after the user confirms. */
export async function runConfirmed(gate: ConfirmGate): Promise<McpRunResult> {
  if (!codec()) {
    reportError("[mcp] MCP_STATE_SECRET isn't set, so confirm tools can't run", { tool: gate.tool });
    return textResult(
      `This action isn't available over MCP right now. The user can do it at ${deploymentUrl()}.`,
      true,
    );
  }
  const { [CONFIRMATION_TOKEN_KEY]: token, ...input } = gate.args;
  return canElicit(gate.request)
    ? viaElicitation(gate, input)
    : viaToken(gate, input, typeof token === "string" ? token : undefined);
}

async function claimAndRun(gate: ConfirmGate, input: Record<string, unknown>, jti: string) {
  const claim = await claimConfirmation(gate.ctx.supabase, { userId: gate.ctx.user.id, tool: gate.tool, jti });
  return claim === "claimed" ? { ran: await gate.run(input) } : { ran: null };
}

async function viaElicitation(gate: ConfirmGate, input: Record<string, unknown>): Promise<McpRunResult> {
  const binding: ConfirmationBinding = { userId: gate.ctx.user.id, tool: gate.tool, via: "elicit" };

  // A retry: our state comes back with the user's answer. A stale, tampered
  // or mismatched state (e.g. the input changed) means asking again.
  const state = gate.request.mcpReq.requestState<unknown>();
  if (typeof state === "string") {
    const verified = await verifyConfirmation(state, binding, input);
    if (verified.ok) {
      const answer = acceptedContent<{ confirm?: unknown }>(gate.request.mcpReq.inputResponses, "confirm");
      if (answer?.confirm !== true) {
        return withOutcome(messageResult("The user declined, so nothing was done."), "denied");
      }
      const { ran } = await claimAndRun(gate, input, verified.jti);
      return (
        ran ??
        withOutcome(messageResult("This was already confirmed and done, so it wasn't run again."), "denied")
      );
    }
  }

  const preview = await gate.preview(input);
  if (!preview.ok) return textResult(preview.error, true);
  return inputRequired({
    inputRequests: {
      confirm: inputRequired.elicit({ message: previewText(preview), requestedSchema: CONFIRM_SCHEMA }),
    },
    requestState: await mintConfirmation(binding, input),
  });
}

async function viaToken(
  gate: ConfirmGate,
  input: Record<string, unknown>,
  token: string | undefined,
): Promise<McpRunResult> {
  const binding: ConfirmationBinding = { userId: gate.ctx.user.id, tool: gate.tool, via: "token" };

  let refused: string | undefined;
  if (token !== undefined) {
    const claim = await claimConfirmationToken(gate.ctx.supabase, binding, input, token);
    if (claim === "claimed") return gate.run(input);
    refused = REFUSALS[claim];
  }

  // The first call, or a refused token: a (new) preview and token.
  const preview = await gate.preview(input);
  if (!preview.ok) return textResult(refused ? `${refused} ${preview.error}` : preview.error, true);
  const result = jsonResult(
    {
      needsConfirmation: true,
      ...(refused ? { refused: `${refused} Here is a new preview and token.` } : {}),
      preview: previewText(preview),
      [CONFIRMATION_TOKEN_KEY]: await issueConfirmationToken(gate.ctx.supabase, binding, input),
      instruction: INSTRUCTION,
    },
    Boolean(refused),
  );
  return withOutcome(result, "needs_confirmation");
}
