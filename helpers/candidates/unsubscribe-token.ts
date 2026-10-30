import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/helpers/agent/auth";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

// BI-REQ-034: the unsubscribe link in every email to a company candidate.
// The token names the candidate and is signed with a key derived from
// INTERNAL_API_SECRET for this one purpose. It doesn't expire: an old
// email's link keeps working.

const PURPOSE = "candidate-unsubscribe:v1";

const keyOf = () => {
  if (!INTERNAL_API_SECRET) throw new Error("INTERNAL_API_SECRET is not set");
  return createHmac("sha256", INTERNAL_API_SECRET).update(PURPOSE).digest();
};

const sign = (candidateId: string) => createHmac("sha256", keyOf()).update(candidateId).digest("base64url");

/** `<candidate id>.<signature>`. */
export function signUnsubscribeToken(candidateId: string): string {
  return `${candidateId}.${sign(candidateId)}`;
}

/** The candidate a token names, or null when it's malformed, tampered or signed with another key. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!INTERNAL_API_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [candidateId, signature] = parts;
  if (!isUuid(candidateId) || !signature) return null;
  const expected = Buffer.from(sign(candidateId));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? candidateId : null;
}

export const unsubscribeUrl = (candidateId: string) =>
  `${deploymentUrl()}/unsubscribe/candidate/${signUnsubscribeToken(candidateId)}`;
