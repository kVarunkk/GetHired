import type { ReactNode } from "react";
import { can, forbiddenMessage, type PermissionKey } from "@/helpers/companies/permissions";
import type { MyCompany } from "@/helpers/companies/get-my-company";

/**
 * The bordered form of a settings section. Without `permission` the whole form
 * is disabled, with the catalog message saying why (RP-REQ-016); the actions
 * check again. Server-safe.
 */
export default function SettingsCard({
  company,
  permission,
  children,
}: {
  company: MyCompany;
  permission: PermissionKey;
  children: ReactNode;
}) {
  const readOnly = can(company, permission) ? null : forbiddenMessage(permission);
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-5">
      {readOnly && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{readOnly}</p>
      )}
      {/* A disabled fieldset disables every control inside. min-w-0 drops the
          fieldset's default min-content width, so wide content can't push it out. */}
      <fieldset disabled={Boolean(readOnly)} title={readOnly ?? undefined} className="min-w-0 disabled:opacity-80">
        {children}
      </fieldset>
    </section>
  );
}
