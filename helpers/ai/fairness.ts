/**
 * Fairness filters for model input (MT-SEC-002, recruiter roadmap). A model
 * that scores or describes a candidate never sees who they are: no name,
 * contact details, links, photo, age, gender, marital status, religion,
 * caste or nationality. Pure functions, safe on the client and the server.
 */

const REMOVED = "[removed]";

/** Key fragments that mark a protected field wherever they appear in a key. */
const PROTECTED_SUBSTRINGS = [
  "email",
  "phone",
  "mobile",
  "linkedin",
  "github",
  "twitter",
  "website",
  "portfolio",
  "avatar",
  "photo",
  "image",
  "birth",
  "gender",
  "sexual",
  "marital",
  "religio",
  "caste",
  "nationality",
  "citizenship",
  "ethnic",
];

/** Whole words (snake_case or camelCase parts) that mark a protected field. */
const PROTECTED_WORDS = new Set([
  "name",
  "dob",
  "age",
  "sex",
  "race",
  "url",
  "link",
  "links",
  "handle",
]);

/** Allowed despite matching a rule above: the job has a visa field. */
const ALLOWED_KEYS = new Set(["visa_sponsorship_required"]);

const wordsOf = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export function isProtectedKey(key: string): boolean {
  if (ALLOWED_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  if (PROTECTED_SUBSTRINGS.some((fragment) => lower.includes(fragment))) return true;
  return wordsOf(key).some((word) => PROTECTED_WORDS.has(word));
}

/**
 * A copy of `record` without protected keys. It errs on the side of dropping:
 * an unknown key that looks like contact or demographic data goes too.
 */
export function stripProtected<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !isProtectedKey(key)),
  ) as Partial<T>;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_WITH_SCHEME = /\b(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;
// A bare domain followed by a path ("linkedin.com/in/x"), or a bare domain on
// a common TLD. "Node.js" and "v2.3.1" don't match either.
const BARE_URL =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,}\/[^\s<>()"']*[^\s<>()"'.,;:!?]|(?:com|in|io|dev|org|net|me|co|ai|app|xyz|tech)\b)/gi;
// A run of digits, spaces, dots, dashes and brackets; it's a phone number
// only if it holds 10 to 15 digits, so years and ranges are left alone.
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{7,}\d/g;

/** Replaces emails, URLs and phone numbers in free text with "[removed]". */
export function scrubPII(text: string): string {
  return text
    .replace(EMAIL, REMOVED)
    .replace(URL_WITH_SCHEME, REMOVED)
    .replace(BARE_URL, REMOVED)
    .replace(PHONE_CANDIDATE, (match) => {
      const digits = match.replace(/\D/g, "").length;
      return digits >= 10 && digits <= 15 ? REMOVED : match;
    });
}
