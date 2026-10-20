import type { MyCompany } from "./get-my-company";

/**
 * How the member's role is shown (the profile menu badge, the team table):
 * "Owner" for owners (RP-GUD-002), else the company's own role name.
 */
export function roleLabel(company: Pick<MyCompany, "isOwner" | "role"> | null | undefined): string | null {
  if (!company) return null;
  if (company.isOwner) return "Owner";
  return company.role?.name ?? null;
}
