import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// IV-SEC-001, spec §4 "Encryption": Google OAuth tokens are sealed with
// AES-256-GCM before they reach the database. The key lives in Secret Manager
// (`CALENDAR_TOKEN_KEYS`, a JSON map of version → base64 key, and
// `CALENDAR_TOKEN_KEY_CURRENT`), never in the DB. Only helpers/calendar/*
// imports this module (test/calendar-token-usage.test.ts).
//
// Stored as `v<version>:<base64 iv>:<base64 ciphertext+tag>`. The AAD binds a
// value to its connection, user and kind, so a ciphertext copied into another
// row, or swapped between the two columns, fails to decrypt.

const IV_BYTES = 12;
const TAG_BYTES = 16;

export type TokenKind = "refresh" | "access";

export type TokenBinding = { connectionId: string; userId: string; kind: TokenKind };

export type SealedToken = { value: string; keyVersion: number };

// Messages never include a key or a token.
function keys(): Map<number, Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(process.env.CALENDAR_TOKEN_KEYS ?? "");
  } catch {
    throw new Error("CALENDAR_TOKEN_KEYS is not set or isn't JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("CALENDAR_TOKEN_KEYS must be a JSON object");
  const out = new Map<number, Buffer>();
  for (const [version, encoded] of Object.entries(parsed as Record<string, unknown>)) {
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1 || typeof encoded !== "string") continue;
    out.set(v, Buffer.from(encoded, "base64"));
  }
  return out;
}

function keyFor(version: number): Buffer {
  const key = keys().get(version);
  if (!key) throw new Error(`CALENDAR_TOKEN_KEYS has no key version ${version}`);
  if (key.length !== 32) throw new Error(`Calendar token key version ${version} must be 32 bytes`);
  return key;
}

function currentVersion(): number {
  const v = Number(process.env.CALENDAR_TOKEN_KEY_CURRENT);
  if (!Number.isInteger(v) || v < 1) throw new Error("CALENDAR_TOKEN_KEY_CURRENT is not set");
  return v;
}

const aadOf = ({ connectionId, userId, kind }: TokenBinding) =>
  Buffer.from(`gethired-calendar-token:${connectionId}:${userId}:${kind}`, "utf8");

/** Seals `plaintext` with the current key. */
export function encryptToken(plaintext: string, binding: TokenBinding): SealedToken {
  const version = currentVersion();
  const key = keyFor(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { value: `v${version}:${iv.toString("base64")}:${ciphertext.toString("base64")}`, keyVersion: version };
}

/** Opens a sealed value. Throws when it's malformed, tampered or bound to something else. */
export function decryptToken(value: string, binding: TokenBinding): string {
  const match = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("Malformed calendar token");
  const key = keyFor(Number(match[1]));
  const iv = Buffer.from(match[2], "base64");
  const sealed = Buffer.from(match[3], "base64");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) throw new Error("Malformed calendar token");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aadOf(binding));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("Couldn't decrypt the calendar token");
  }
}
