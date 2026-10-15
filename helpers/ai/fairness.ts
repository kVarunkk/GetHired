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

export type FairnessContext = "candidate_filter" | "memory" | "job_post";

/**
 * A protected characteristic (or a proxy for one) that candidates must never
 * be filtered, ranked or described by (RA-SEC-004). `exclusionary` patterns
 * apply to job posts too; the rest only to candidate filters and memories,
 * where any mention is out of place.
 */
type FairnessRule = { term: string; pattern: RegExp; exclusionary?: boolean };

const GROUP = String.raw`(?:men|women|males?|females?|boys?|girls?|ladies|gents)`;
// An age bound: "under 25", "below 30 years old". Not "over 20 years of experience" or "under 30 LPA".
const AGE_BOUND = String.raw`\b(?:under|below|above|over|younger than|older than|less than|max(?:imum)?(?: age)?)\s+(?:1[89]|[2-6]\d)\b(?!\s*(?:\+|%|lpa|lakhs?|l\b|k\b|cr\b|(?:years?|yrs?)\s+(?:of\s+)?(?:exp|experience|work)))`;

const RULES: FairnessRule[] = [
  // Age and its proxies.
  { term: "age", pattern: new RegExp(AGE_BOUND), exclusionary: true },
  { term: "age", pattern: /\bage(?:d|s)?\b\s*(?:\d|of|limit|between|group|bar)|\bage\s*:|\bage\b$/, exclusionary: true },
  { term: "age", pattern: /\b\d{2}\s*(?:-|to)\s*\d{2}\s*(?:years? old|yrs? old|age)\b|\byears? old\b|\byrs? old\b/, exclusionary: true },
  { term: "young", pattern: /\b(?:young|younger|youthful|old|older|elderly|aged|middle-aged)\b(?!-?(?:er)?\s*(?:codebase|code|systems?|stack))/ },
  { term: "graduation year", pattern: /\bgraduat(?:ed|ion|ing)\s+(?:in|year|before|after|from)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s+(?:batch|pass\s?-?outs?|graduates?)\b|\b(?:batch|class)\s+of\s+(?:19|20)\d{2}\b|\bpass\s?-?out\s+(?:year|in)\b/, exclusionary: true },
  // Gender.
  { term: "gender", pattern: new RegExp(String.raw`\b(?:only\s+${GROUP}|${GROUP}\s+(?:candidates?\s+)?only)\b`), exclusionary: true },
  { term: "gender", pattern: /\b(?:male|female|men|women|man|woman|boys?|girls?|ladies|lady|gentlemen|gender|transgender|non-binary)\b/ },
  { term: "gender", pattern: /\b(?:ladka|ladki|ladke|ladkiyan|mahila|aurat)\b/, exclusionary: true },
  // Marital and family status, pregnancy.
  { term: "marital status", pattern: /\b(?:married|unmarried|marital|spouse|divorced|widow(?:ed)?|shaadi|shadi)\b/, exclusionary: true },
  { term: "family status", pattern: /\b(?:kids|children|pregnan\w*|maternity|family planning)\b/, exclusionary: true },
  // Religion and caste.
  { term: "religion", pattern: /\b(?:religion|religious|hindus?|muslims?|christians?|sikhs?|jains?|buddhists?|jews?|jewish|parsis?|dharm|dharma)\b/, exclusionary: true },
  { term: "caste", pattern: /\b(?:castes?|jaati|jati|brahmins?|dalits?|kshatriyas?|vaishyas?|shudras?|rajputs?|obc|sc\s*\/\s*st|scheduled (?:caste|tribe)s?)\b/, exclusionary: true },
  // Race, ethnicity, national origin.
  { term: "race", pattern: /\b(?:race(?!\s*conditions?)|racial|ethnic\w*|caucasian|hispanic|latin[oa]s?|african american|skin colou?r|fair skin|fair complexion|complexion)\b/, exclusionary: true },
  { term: "national origin", pattern: /\b(?:nationality|national origin|ethnic origin)\b/, exclusionary: true },
  // Disability and sexual orientation.
  { term: "disability", pattern: /\b(?:disabled|disabilit(?:y|ies)|handicap\w*|able-bodied|wheelchair)\b/, exclusionary: true },
  { term: "sexual orientation", pattern: /\b(?:gay|lesbian|lgbt\w*|queer|homosexual|heterosexual|sexual orientation)\b/, exclusionary: true },
  // Appearance.
  { term: "photo", pattern: /\b(?:photo|photos|photograph|good-looking|attractive|looks)\b/, exclusionary: true },
];

/**
 * A deterministic deny-list check for text the agent would filter, rank or
 * remember candidates by (RA-SEC-004). The prompt rule is the first defence;
 * this catches the clear cases. Whole words only, so "Java", "Go" or "race
 * conditions" pass. `job_post` only rejects exclusionary requirements, so a
 * job post may describe a "female-founded company".
 */
export function screenFairnessText(
  text: string,
  { context }: { context: FairnessContext },
): { ok: true } | { ok: false; term: string } {
  const normalised = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  for (const rule of RULES) {
    if (context === "job_post" && !rule.exclusionary) continue;
    if (rule.pattern.test(normalised)) return { ok: false, term: rule.term };
  }
  return { ok: true };
}
