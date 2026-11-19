/**
 * Company accounts need a work email. Client-safe: the sign-up form, the
 * sign-up action and both agents' prompts share this list.
 */
export const GENERIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  "gmail.com",
  "googlemail.com",
  // Yahoo
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "yahoo.in",
  "yahoo.ca",
  "yahoo.com.au",
  "yahoo.fr",
  "yahoo.de",
  "ymail.com",
  "rocketmail.com",
  // Microsoft
  "outlook.com",
  "outlook.in",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "live.com",
  "live.in",
  "live.co.uk",
  "msn.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // AOL
  "aol.com",
  "aim.com",
  // Privacy and other webmail
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
  "hushmail.com",
  "zoho.com",
  "zohomail.com",
  "zohomail.in",
  "mail.com",
  "email.com",
  "inbox.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  // ISPs
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "btinternet.com",
  "sky.com",
  "orange.fr",
  "free.fr",
  "libero.it",
  // Disposable
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "temp-mail.org",
  "yopmail.com",
]);

/** The examples the agents name; the full list is too long for a prompt. */
export const GENERIC_EMAIL_EXAMPLES = "Gmail, Outlook, Yahoo, iCloud or Proton";

export const GENERIC_EMAIL_MESSAGE = "Company email cannot be a generic public domain.";

export function isGenericEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return GENERIC_EMAIL_DOMAINS.has(domain);
}
