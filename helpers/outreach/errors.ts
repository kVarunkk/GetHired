// Maps the codes raised by send_candidate_outreach and respond_to_outreach
// (20261016120000_recruiter_outreach.sql) to user copy. Client-safe: the
// composer and the respond form reuse the codes.

export type OutreachErrorCode =
  | "OUTREACH_LIMIT"
  | "ALREADY_OPEN"
  | "NOT_ACCEPTING"
  | "CANDIDATE_LIMIT"
  | "NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "NOT_MEMBER"
  | "INVALID_INPUT"
  | "ALREADY_ANSWERED"
  | "EXPIRED"
  | "UNKNOWN";

export type OutreachError = { code: OutreachErrorCode; status: number; message: string };

const ERRORS: Record<Exclude<OutreachErrorCode, "UNKNOWN">, Omit<OutreachError, "code">> = {
  OUTREACH_LIMIT: {
    status: 402,
    message: "You've used this month's outreach. Upgrade to send more.",
  },
  ALREADY_OPEN: {
    status: 409,
    message: "You already have an open message to this candidate about this job.",
  },
  NOT_ACCEPTING: {
    status: 403,
    message: "This candidate isn't accepting outreach right now.",
  },
  CANDIDATE_LIMIT: {
    status: 429,
    message: "You've contacted this candidate 3 times in the last 90 days. Wait for a reply.",
  },
  // A block also raises NOT_FOUND, so a company can't tell it was blocked.
  NOT_FOUND: { status: 404, message: "This candidate isn't available to contact." },
  JOB_NOT_FOUND: { status: 404, message: "That job wasn't found in your company." },
  NOT_MEMBER: { status: 403, message: "Only company accounts can send outreach." },
  INVALID_INPUT: { status: 400, message: "Check the subject and message and try again." },
  ALREADY_ANSWERED: { status: 409, message: "You've already answered this message." },
  EXPIRED: { status: 410, message: "This message has expired." },
};

const UNKNOWN: OutreachError = {
  code: "UNKNOWN",
  status: 500,
  message: "Something went wrong. Try again.",
};

function isKnown(code: string): code is Exclude<OutreachErrorCode, "UNKNOWN"> {
  return Object.prototype.hasOwnProperty.call(ERRORS, code);
}

/** A PostgREST error from an outreach RPC. Never echoes an unknown DB message. */
export function mapOutreachError(err: unknown): OutreachError {
  if (!err || typeof err !== "object") return UNKNOWN;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code !== "P0001" || typeof message !== "string" || !isKnown(message)) return UNKNOWN;
  return { code: message, ...ERRORS[message] };
}

export function outreachLimitError(): OutreachError {
  return { code: "OUTREACH_LIMIT", ...ERRORS.OUTREACH_LIMIT };
}
