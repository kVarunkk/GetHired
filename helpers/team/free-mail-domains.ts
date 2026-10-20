/**
 * Free-mail domains (TM-REQ-010). When the owner signs in with one of these,
 * a different invitee domain says nothing about trust, so no notice is shown.
 * A short list on purpose: it only decides whether a hint appears.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.in",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "zohomail.in",
  "gmx.com",
  "mail.com",
  "rediffmail.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
]);

/** The lowercased domain of an email, or null when there isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = email?.trim().lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  const domain = email.trim().slice(at + 1).toLowerCase();
  return domain || null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * TM-REQ-010: a non-blocking notice when the invitee's domain differs from the
 * owner's, unless the owner's domain is free mail. Null when there's nothing
 * to say.
 */
export function domainNotice(ownerEmail: string | null | undefined, inviteeEmail: string): string | null {
  const owner = emailDomain(ownerEmail);
  const invitee = emailDomain(inviteeEmail);
  if (!owner || !invitee || owner === invitee || isFreeMailDomain(owner)) return null;
  return `Not an @${owner} address. Make sure you trust this person.`;
}
