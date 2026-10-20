import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/utils";

// RP-GUD-001: the 8 role colours are theme tokens (app/globals.css --role-*),
// as text on a 10% tint, like the status badges. Literal strings, so Tailwind
// keeps them.
const COLOR_CLASS: Record<string, string> = {
  slate: "border-role-slate/30 bg-role-slate/10 text-role-slate",
  indigo: "border-role-indigo/30 bg-role-indigo/10 text-role-indigo",
  emerald: "border-role-emerald/30 bg-role-emerald/10 text-role-emerald",
  amber: "border-role-amber/30 bg-role-amber/10 text-role-amber",
  rose: "border-role-rose/30 bg-role-rose/10 text-role-rose",
  sky: "border-role-sky/30 bg-role-sky/10 text-role-sky",
  violet: "border-role-violet/30 bg-role-violet/10 text-role-violet",
  teal: "border-role-teal/30 bg-role-teal/10 text-role-teal",
};

/** A member's role as a coloured badge, or "Owner" (RP-REQ-013, RP-GUD-002). */
export default function RoleBadge({
  role,
  owner = false,
  primary = false,
  className,
}: {
  role?: { name: string; color: string } | null;
  owner?: boolean;
  primary?: boolean;
  className?: string;
}) {
  if (owner) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        <Badge variant="outline">Owner</Badge>
        {primary && (
          <Badge variant="outline" className="text-muted-foreground" title="The billing contact">
            Primary
          </Badge>
        )}
      </span>
    );
  }
  if (!role) return <Badge variant="outline">No role</Badge>;
  return (
    <Badge variant="outline" className={cn(COLOR_CLASS[role.color] ?? COLOR_CLASS.slate, className)}>
      {role.name}
    </Badge>
  );
}
