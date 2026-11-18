import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * MPT-030/031 (MP-REQ-008): what a board's application webhook carries once
 * its own format is read. Each board has an adapter that checks the
 * signature over the raw body and turns the JSON into this. Indeed Apply
 * (spec 10.4) signs the body; Talent Apply (10.3) documents no signing, so
 * its `posturl` carries a per-job token instead.
 */
export type BoardApplication = {
  /** The board's application id: the idempotency key and, for Indeed, the disposition key. */
  externalId: string;
  /** The id our feed gave the board: the public job id (`job_postings.job_id`). */
  jobRef: string;
  applicant: { fullName: string; email: string; phone: string | null };
  /** Base64 file data as the board sent it, read after the reply. */
  resumeBase64: string | null;
  /** Kept in channel_events for audit. Never contact details or the resume. */
  summary: Record<string, string | number | boolean | null>;
};

export type BoardAdapter = {
  /** The env var holding the shared secret; the channel is off without it. */
  secretEnv: string;
  /** `url` is the request URL, for boards that authenticate through it. */
  verify(rawBody: string, headers: Headers, secret: string, url: URL): boolean;
  parse(body: unknown): BoardApplication | null;
};

/** Constant-time compare of two strings of any length. */
function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const uuid = z.string().trim().uuid();
const text = (max: number) => z.string().trim().max(max);

// Indeed Apply (spec 10.4). Unknown keys are ignored: Indeed adds fields.
const indeedSchema = z.object({
  id: text(200).min(1),
  appliedOnMillis: z.number().optional(),
  job: z.object({ jobId: uuid, jobKey: text(200).optional() }),
  applicant: z.object({
    fullName: text(200).optional(),
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    email: text(320).min(3),
    phoneNumber: text(50).optional(),
    verified: z.boolean().optional(),
    resume: z.object({ file: z.object({ data: z.string().min(1) }).optional() }).optional(),
  }),
  analytics: z.object({ sponsored: z.boolean().optional() }).optional(),
});

export const indeedAdapter: BoardAdapter = {
  secretEnv: "INDEED_APPLY_SECRET",
  // X-Indeed-Signature: Base64 HMAC-SHA1 of the raw body. Indeed's Node sample
  // differs from its prose, so confirm with a real delivery before going live.
  verify(rawBody, headers, secret) {
    const given = headers.get("x-indeed-signature");
    if (!given) return false;
    const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest("base64");
    return sameString(given.trim(), expected);
  },
  parse(body) {
    const parsed = indeedSchema.safeParse(body);
    if (!parsed.success) return null;
    const { id, job, applicant, appliedOnMillis, analytics } = parsed.data;
    const fullName =
      applicant.fullName || [applicant.firstName, applicant.lastName].filter(Boolean).join(" ").trim();
    if (!fullName) return null;
    return {
      externalId: id,
      jobRef: job.jobId,
      applicant: { fullName, email: applicant.email.toLowerCase(), phone: applicant.phoneNumber || null },
      resumeBase64: applicant.resume?.file?.data ?? null,
      summary: {
        job_key: job.jobKey ?? null,
        applied_at: appliedOnMillis != null ? new Date(appliedOnMillis).toISOString() : null,
        sponsored: analytics?.sponsored ?? null,
        verified: applicant.verified ?? null,
        has_resume: Boolean(applicant.resume?.file?.data),
      },
    };
  },
};

/**
 * Talent Apply's token for one job: base64url HMAC-SHA256 of the job id. The
 * feed is public, so the token is per job rather than the secret itself: a
 * token read from the feed only lets someone apply to that job, as the job
 * page already does.
 */
export function talentApplyToken(jobId: string, secret: string): string {
  return createHmac("sha256", secret).update(`talent-apply:${jobId}`, "utf8").digest("base64url");
}

/** The `talent-apply-posturl` the Talent.com feed gives a job. */
export function talentApplyPostUrl(jobId: string, secret: string, base = "https://gethired.devhub.co.in"): string {
  return `${base}/api/webhooks/jobboards/talent?${new URLSearchParams({ token: talentApplyToken(jobId, secret) })}`;
}

// Talent Apply (talent.com/integrations, "JSON standard example"). Unknown
// keys, including the screening `questions` object, are ignored.
const talentSchema = z.object({
  id: text(200).min(1),
  job: z.object({ jobId: uuid, jobTitle: text(500).optional() }),
  applicant: z.object({
    fullName: text(200).min(1),
    email: text(320).min(3),
    phoneNumber: text(50).optional(),
    resume: z
      .object({ file: z.object({ data: z.string().min(1), contentType: text(200).optional() }).optional() })
      .optional(),
  }),
  analytics: z.object({ device: text(50).optional() }).optional(),
});

export const talentAdapter: BoardAdapter = {
  secretEnv: "TALENT_APPLY_SECRET",
  verify(rawBody, _headers, secret, url) {
    const token = url.searchParams.get("token");
    if (!token) return false;
    let jobId: unknown;
    try {
      jobId = (JSON.parse(rawBody) as { job?: { jobId?: unknown } })?.job?.jobId;
    } catch {
      return false;
    }
    return typeof jobId === "string" && sameString(token, talentApplyToken(jobId, secret));
  },
  parse(body) {
    const parsed = talentSchema.safeParse(body);
    if (!parsed.success) return null;
    const { id, job, applicant, analytics } = parsed.data;
    return {
      externalId: id,
      jobRef: job.jobId,
      applicant: { fullName: applicant.fullName, email: applicant.email.toLowerCase(), phone: applicant.phoneNumber || null },
      resumeBase64: applicant.resume?.file?.data ?? null,
      summary: {
        device: analytics?.device ?? null,
        resume_type: applicant.resume?.file?.contentType ?? null,
        has_resume: Boolean(applicant.resume?.file?.data),
      },
    };
  },
};

/** Boards whose webhook we accept, by `distribution_channels.key`. */
export const BOARD_ADAPTERS: Readonly<Record<string, BoardAdapter>> = {
  indeed: indeedAdapter,
  talent: talentAdapter,
};

export type IngestReason = "unknown_channel" | "invalid" | "unknown_job" | "closed" | "duplicate" | "already_in_job";

/**
 * The reply a refusal gets, in Indeed's codes (spec 10.4): 409 duplicate,
 * 410 the job is gone, 404 unknown job, 400 a bad payload. Anything else
 * would make the board retry or disable the integration.
 */
export function ingestStatus(reason: string | undefined): number {
  switch (reason) {
    case "duplicate":
    case "already_in_job":
      return 409;
    case "closed":
      return 410;
    case "unknown_job":
    case "unknown_channel":
      return 404;
    case "invalid":
      return 400;
    default:
      return 500;
  }
}
