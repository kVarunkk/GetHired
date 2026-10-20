// CP-REQ-001. Matches careers_slug_valid / slugify_company_name in
// supabase/migrations/20261017230000_careers_page.sql. Client-safe.

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

export const RESERVED_SLUGS = [
  "admin",
  "api",
  "app",
  "auth",
  "blog",
  "careers",
  "companies",
  "company",
  "dashboard",
  "edit",
  "gethired",
  "help",
  "jobs",
  "login",
  "new",
  "preview",
  "settings",
  "signup",
  "support",
  "www",
] as const;

export function validateSlug(input: string): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = input.trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return { ok: false, error: "Use 3 to 40 characters." };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "Use lowercase letters, numbers and single dashes." };
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return { ok: false, error: "That address is reserved." };
  return { ok: true, slug };
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
  if (s.length >= SLUG_MIN) return s;
  return s === "" ? "company" : `${s}-jobs`;
}

/** The public path of a careers page. */
export const careersPath = (slug: string) => `/careers/${slug}`;
