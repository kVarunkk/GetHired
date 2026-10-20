// CP-CON-001: careers pages are cached per slug and per company. Careers
// edits revalidate the slug's tag; job create, edit, close and delete
// revalidate the company's.
export const careersSlugTag = (slug: string) => `careers:${slug}`;
export const careersCompanyTag = (companyId: string) => `careers-company:${companyId}`;
