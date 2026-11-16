import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { deploymentUrl } from "@/utils/formatters";

// IV-SEC-003: a self-scheduling link's token is 32 random bytes. Only its
// sha256 is stored (scheduled_interviews.booking_token_hash), and the SQL
// side (scheduling_token_hash) hashes what it's given the same way, as for
// claim links (helpers/candidates/claim-token.ts). Never log the token.

export const newSchedulingToken = () => randomBytes(32).toString("base64url");

export const hashSchedulingToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const schedulingPath = (token: string) => `/schedule/${token}`;

export const schedulingUrl = (token: string) => `${deploymentUrl()}${schedulingPath(token)}`;

/** A new link: the URL to email once, and the hash to store. */
export function newSchedulingLink(): { token: string; hash: string; url: string } {
  const token = newSchedulingToken();
  return { token, hash: hashSchedulingToken(token), url: schedulingUrl(token) };
}
