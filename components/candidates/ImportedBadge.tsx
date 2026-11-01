import Link from "next/link";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { ApplicationPerson } from "@/helpers/applications/application-person";

/**
 * BI-REQ-030: marks a company candidate (or a claimed one) wherever an
 * applicant is shown, plus "No resume", which explains a missing score, and
 * for a claimed one a link to the connected GetHired account (BIT-101).
 */
export default function ImportedBadge({
  person,
}: {
  person: Pick<ApplicationPerson, "imported" | "hasResume" | "connectedUserId">;
}) {
  if (!person.imported) return null;
  return (
    <>
      <Badge variant="outline" title="Added by your team, not through GetHired">
        Imported
      </Badge>
      {!person.hasResume && (
        <Badge variant="warning" title="Without a resume or enough detail, they can't be scored">
          No resume
        </Badge>
      )}
      {person.connectedUserId && (
        <Link
          href={`/company/profiles/${person.connectedUserId}`}
          className={badgeVariants({ variant: "outline", className: "hover:bg-muted" })}
          title="They claimed this record with a GetHired account. Open their profile."
        >
          GetHired account connected
        </Link>
      )}
    </>
  );
}
