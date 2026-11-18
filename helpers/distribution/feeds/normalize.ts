/**
 * Turns stored job fields into what the feed specs ask for (plan/multiposting
 * spec section 10). Pure, client-safe. Jobs store the description as plain
 * text, shown on the page with its line breaks kept, and older rows hold the
 * currency as a symbol; the boards want HTML and ISO 4217 codes.
 */

import { toIsoCurrency } from "@/helpers/currency/currencies";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BULLET = /^\s*(?:[-*•●▪◦]|–)\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

/**
 * Plain text to HTML with the same content and order as the job page:
 * blank lines start paragraphs, single line breaks become `<br>`, and runs
 * of `-`/`*`/`•` or `1.` lines become lists. Everything is escaped, so text
 * like `<5 years` or `R&D` reads the same as on the page.
 */
export function textToHtml(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(escapeHtml).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      const tag = bullet ? "ul" : "ol";
      flushParagraph();
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(item.trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}

/** An ISO 4217 code, or null when the stored value isn't one we know. */
export const isoCurrency = toIsoCurrency;

/** A salary bound; the form's default 0 means "not given". */
export const salaryBound = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/** `buildSalaryRange` writes this when there's no salary. */
export const NO_SALARY_TEXT = /^\s*(not specified|n\/?a|-|0)?\s*$/i;

const WORKPLACE = "remote|hybrid|on-?site|in-?office|wfh|work from home";
const TYPES = "full[- ]?time|part[- ]?time|contract(?:ual)?|internship|intern|freelance|temporary";
const NOISE = new RegExp(
  `\\b(?:urgent(?:ly)?(?:\\s+(?:hiring|required|opening|requirement))?|immediate\\s+joiners?|hiring\\s+now|apply\\s+now|walk-?in)\\b`,
  "gi",
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The job title without what Adzuna and Talent.com forbid in it: urgency
 * words, the location, the workplace or job type, salary and ids, whether in
 * brackets or after a separator. Falls back to the stored title if nothing
 * would be left.
 */
export function cleanFeedTitle(title: string, locations: string[] = []): string {
  const places = locations.map((l) => l.trim()).filter((l) => l.length > 1).map(escapeRe);
  const extra = [WORKPLACE, TYPES, ...places].join("|");
  // Salary-looking or id-looking text; a level like "(L2)" stays.
  const money = "₹|\\$|€|£|\\blpa\\b|\\bctc\\b|salary|\\d+\\s*k\\b|\\d{4,}|\\d+\\s*-\\s*\\d+";
  const bracketed = new RegExp(`[([{][^)\\]}]*(?:${extra}|${money}|#|\\bid\\b)[^)\\]}]*[)\\]}]`, "gi");
  const trailing = new RegExp(`\\s*(?:[-–—|,@/:]|\\bin\\b|\\bat\\b)\\s*(?:${extra})(?:\\s*[,/&]\\s*(?:${extra}))*\\s*$`, "i");
  const jobId = /\s*(?:[-–—|,:]\s*)?(?:job\s*)?(?:id|ref|req)\s*[:#]?\s*[\w-]*\d[\w-]*\s*$/i;

  let t = title.replace(NOISE, " ").replace(bracketed, " ").replace(/[([{]\s*[)\]}]/g, " ");
  for (let i = 0; i < 3; i++) t = t.replace(trailing, "").replace(jobId, "");
  t = t.replace(/\s{2,}/g, " ").replace(/^[\s\-–—|,:!]+|[\s\-–—|,:!]+$/g, "").trim();
  return t.length >= 2 ? t : title.trim();
}

export type LogoType = "png" | "jpeg" | "gif" | "webp" | "svg" | "other";

/** A logo's type from its Content-Type header. */
export function logoTypeOf(contentType: string | null | undefined): LogoType | null {
  if (!contentType) return null;
  const t = contentType.split(";")[0].trim().toLowerCase();
  if (t === "image/png") return "png";
  if (t === "image/jpeg" || t === "image/jpg") return "jpeg";
  if (t === "image/gif") return "gif";
  if (t === "image/webp") return "webp";
  if (t === "image/svg+xml") return "svg";
  return t.startsWith("image/") ? "other" : null;
}

/** Indian states and union territories by city, for Talent.com's required `state`. */
const INDIAN_STATES: Record<string, string> = {
  bangalore: "Karnataka", bengaluru: "Karnataka", mysore: "Karnataka", mysuru: "Karnataka", mangalore: "Karnataka", mangaluru: "Karnataka", hubli: "Karnataka",
  mumbai: "Maharashtra", bombay: "Maharashtra", pune: "Maharashtra", "navi mumbai": "Maharashtra", thane: "Maharashtra", nagpur: "Maharashtra", nashik: "Maharashtra", aurangabad: "Maharashtra",
  delhi: "Delhi", "new delhi": "Delhi", "delhi ncr": "Delhi", ncr: "Delhi",
  gurgaon: "Haryana", gurugram: "Haryana", faridabad: "Haryana", panchkula: "Haryana",
  noida: "Uttar Pradesh", "greater noida": "Uttar Pradesh", ghaziabad: "Uttar Pradesh", lucknow: "Uttar Pradesh", kanpur: "Uttar Pradesh", varanasi: "Uttar Pradesh",
  hyderabad: "Telangana", secunderabad: "Telangana", warangal: "Telangana",
  chennai: "Tamil Nadu", madras: "Tamil Nadu", coimbatore: "Tamil Nadu", madurai: "Tamil Nadu", trichy: "Tamil Nadu", tiruchirappalli: "Tamil Nadu",
  kolkata: "West Bengal", calcutta: "West Bengal", durgapur: "West Bengal",
  ahmedabad: "Gujarat", surat: "Gujarat", vadodara: "Gujarat", baroda: "Gujarat", rajkot: "Gujarat", gandhinagar: "Gujarat",
  jaipur: "Rajasthan", jodhpur: "Rajasthan", udaipur: "Rajasthan",
  kochi: "Kerala", cochin: "Kerala", thiruvananthapuram: "Kerala", trivandrum: "Kerala", kozhikode: "Kerala", calicut: "Kerala",
  chandigarh: "Chandigarh", mohali: "Punjab", ludhiana: "Punjab", amritsar: "Punjab",
  indore: "Madhya Pradesh", bhopal: "Madhya Pradesh",
  bhubaneswar: "Odisha", cuttack: "Odisha",
  visakhapatnam: "Andhra Pradesh", vizag: "Andhra Pradesh", vijayawada: "Andhra Pradesh", amaravati: "Andhra Pradesh",
  patna: "Bihar", ranchi: "Jharkhand", jamshedpur: "Jharkhand", raipur: "Chhattisgarh",
  guwahati: "Assam", dehradun: "Uttarakhand", shimla: "Himachal Pradesh", goa: "Goa", panaji: "Goa",
  srinagar: "Jammu and Kashmir", jammu: "Jammu and Kashmir", puducherry: "Puducherry", pondicherry: "Puducherry",
};

export const indianState = (city: string | null | undefined): string | null =>
  city ? (INDIAN_STATES[city.trim().toLowerCase()] ?? null) : null;

/** Talent.com's job categories (their XML guide, "Job Categories section"); any other value is ignored. */
export const TALENT_CATEGORIES = [
  "Accounting", "Administration", "Agriculture", "Arts", "Computer", "Construction", "Consulting",
  "Customer Service", "Education", "Engineering", "Finance", "Food Industry", "Healthcare", "Hospitality",
  "Human Resources", "Insurance", "IT", "Legal", "Logistics", "Manufacturing", "Marketing", "Media",
  "Multimedia", "Nursing", "Physicians", "Sales", "Scientific", "Security", "Services", "Skilled Labor",
  "Social Care", "Telecommunications", "Training", "Transportation", "Travel", "Retail", "Warehouse",
] as const;
export type TalentCategory = (typeof TALENT_CATEGORIES)[number];

// First match wins, so the narrow ones come before "Engineering" and "IT".
const TALENT_CATEGORY_RULES: [RegExp, TalentCategory][] = [
  [/\bnurs/i, "Nursing"],
  [/\b(?:doctor|physician|surgeon|mbbs)\b/i, "Physicians"],
  [/\b(?:health|medical|clinic|hospital|pharma|patient)/i, "Healthcare"],
  [/\b(?:account|audit|tax|bookkeep|payroll)/i, "Accounting"],
  [/\b(?:financ|banking|treasury|invest|credit|fp&a)/i, "Finance"],
  [/\binsuranc/i, "Insurance"],
  [/\b(?:legal|lawyer|counsel|compliance|paralegal)/i, "Legal"],
  [/\b(?:hr|human resource|recruit|talent acquisition|people ops)/i, "Human Resources"],
  [/\b(?:customer (?:service|support|success|care)|call cent|bpo)/i, "Customer Service"],
  [/\bsales\b|business development|\bbde?\b|account (?:executive|manager)|pre-?sales/i, "Sales"],
  [/\b(?:marketing|seo|sem|growth|brand|content|social media|pr)\b/i, "Marketing"],
  [/\b(?:design|ui|ux|graphic|animat|video|motion)/i, "Multimedia"],
  [/\b(?:media|journalis|editor|writer)/i, "Media"],
  [/\b(?:teach|tutor|education|academic|professor|lecturer)/i, "Education"],
  [/\btrain(?:ing|er)\b/i, "Training"],
  [/\b(?:consult|advisory)/i, "Consulting"],
  [/\b(?:research|scien|lab|chemist|biolog|r&d)/i, "Scientific"],
  [/\b(?:warehouse|inventory|picker|packer)/i, "Warehouse"],
  [/\b(?:logistic|supply chain|procure|purchas|shipping)/i, "Logistics"],
  [/\b(?:driver|transport|fleet|delivery)/i, "Transportation"],
  [/\b(?:travel|tourism)/i, "Travel"],
  [/\b(?:hotel|hospitality|restaurant|chef|cook)/i, "Hospitality"],
  [/\b(?:retail|store|cashier|merchandis)/i, "Retail"],
  [/\b(?:manufactur|production|plant|factory|assembly)/i, "Manufacturing"],
  [/\b(?:construct|civil|site engineer|architect)/i, "Construction"],
  [/\b(?:electrician|plumber|welder|technician|mechanic\b|carpenter)/i, "Skilled Labor"],
  [/\btelecom/i, "Telecommunications"],
  [/\b(?:security guard|security officer)/i, "Security"],
  [/\b(?:computer operator|hardware|data entry)\b/i, "Computer"],
  [/\b(?:it|devops|sre|cloud|network|cyber|infra|sysadmin|data|ml|ai|qa|tech)\b|information technology|software|develop|programm|front-?end|back-?end|full[- ]?stack|android|\bios\b|\bweb\b/i, "IT"],
  [/\bengineer/i, "Engineering"],
  [/\b(?:admin|office|operations|executive assistant|secretary|receptionist)/i, "Administration"],
];

/**
 * A Talent.com category from the job's department, else its title. Null
 * when nothing fits, and then the feed leaves the tag out.
 */
export function talentCategory(department: string | null | undefined, title: string): TalentCategory | null {
  for (const text of [department, title]) {
    if (!text?.trim()) continue;
    const exact = TALENT_CATEGORIES.find((c) => c.toLowerCase() === text.trim().toLowerCase());
    if (exact) return exact;
    const rule = TALENT_CATEGORY_RULES.find(([re]) => re.test(text));
    if (rule) return rule[1];
  }
  return null;
}

/** The city part of a free-text place such as "Bengaluru, Karnataka, India". */
export const cityOf = (place: string | null | undefined): string | null => place?.split(",")[0]?.trim() || null;
