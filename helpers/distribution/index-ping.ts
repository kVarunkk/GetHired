import { createSign } from "node:crypto";

/** Senders for the `index` channels. Pure of Supabase; `fetchImpl` is injectable for tests. */

type Fetch = typeof fetch;

export const SITE_HOST = "gethired.devhub.co.in";
export const jobPageUrl = (jobId: string) => `https://${SITE_HOST}/jobs/${jobId}`;

export type PingResult = { ok: boolean; skipped?: boolean; status?: number; error?: string };

/** IndexNow (Bing, Yandex and others). Skipped without `INDEXNOW_KEY`. */
export async function pingIndexNow(
  urls: string[],
  { key = process.env.INDEXNOW_KEY, fetchImpl = fetch }: { key?: string; fetchImpl?: Fetch } = {},
): Promise<PingResult> {
  if (!key) return { ok: true, skipped: true };
  if (urls.length === 0) return { ok: true, skipped: true };
  try {
    const res = await fetchImpl("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: SITE_HOST,
        key,
        keyLocation: `https://${SITE_HOST}/indexnow-key`,
        urlList: urls,
      }),
    });
    // 200 and 202 are accepted; 429 and 5xx are worth a retry.
    return { ok: res.status === 200 || res.status === 202, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

type ServiceAccount = { client_email: string; private_key: string };

function readServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    return parsed.client_email && parsed.private_key
      ? { client_email: parsed.client_email, private_key: parsed.private_key }
      : null;
  } catch {
    return null;
  }
}

/**
 * Google Indexing API for one URL. Officially it supports `JobPosting` pages
 * (MP-OPEN-005). Skipped without `GOOGLE_INDEXING_SERVICE_ACCOUNT` (the JSON
 * key, as one env var).
 */
export async function pingGoogleIndexing(
  url: string,
  type: "URL_UPDATED" | "URL_DELETED",
  {
    serviceAccount = process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT,
    fetchImpl = fetch,
    now = () => Math.floor(Date.now() / 1000),
  }: { serviceAccount?: string; fetchImpl?: Fetch; now?: () => number } = {},
): Promise<PingResult> {
  const account = readServiceAccount(serviceAccount);
  if (!account) return { ok: true, skipped: true };
  try {
    const iat = now();
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/indexing",
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp: iat + 3600,
      }),
    );
    const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
    const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${b64url(signature)}`,
      }),
    });
    if (!tokenRes.ok) return { ok: false, status: tokenRes.status, error: "token request failed" };
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return { ok: false, error: "no access token" };

    const res = await fetchImpl("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ url, type }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}
