import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/helpers/agent/auth";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

// JA-REQ-036: the one-click pause link in every job alert email. The same
// scheme as helpers/candidates/unsubscribe-token.ts with its own purpose, so
// the key differs: a candidate unsubscribe token never verifies here, and an
// alert token never verifies there. It doesn't expire: an old email's link
// keeps working.

const PURPOSE = "job-alert-pause:v1";

const keyOf = () => {
  if (!INTERNAL_API_SECRET) throw new Error("INTERNAL_API_SECRET is not set");
  return createHmac("sha256", INTERNAL_API_SECRET).update(PURPOSE).digest();
};

const sign = (alertId: string) => createHmac("sha256", keyOf()).update(alertId).digest("base64url");

/** `<alert id>.<signature>`. */
export function signAlertPauseToken(alertId: string): string {
  return `${alertId}.${sign(alertId)}`;
}

/** The alert a token names, or null when it's malformed, tampered or signed for another purpose. */
export function verifyAlertPauseToken(token: string): string | null {
  if (!INTERNAL_API_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [alertId, signature] = parts;
  if (!isUuid(alertId) || !signature) return null;
  const expected = Buffer.from(sign(alertId));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? alertId : null;
}

/** The page behind "Pause this alert" (a button there pauses it). */
export const alertPauseUrl = (alertId: string) =>
  `${deploymentUrl()}/unsubscribe/alert/${signAlertPauseToken(alertId)}`;

/** The `List-Unsubscribe` target: mail clients POST here to pause in one click (RFC 8058). */
export const alertOneClickPauseUrl = (alertId: string) =>
  `${deploymentUrl()}/api/job-alerts/pause/${signAlertPauseToken(alertId)}`;
