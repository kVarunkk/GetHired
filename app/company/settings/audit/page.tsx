import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentAboutAudit } from "@/components/agent/recruiter/AskAgentAboutTeam";
import AuditLog from "@/components/audit/AuditLog";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import { AUDIT_ACTION_GROUP_VALUES, type AuditActionGroup, type AuditFilters } from "@/helpers/companies/audit";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listAudit } from "@/helpers/companies/list-audit";
import { can } from "@/helpers/companies/permissions";
import { listTeam } from "@/helpers/team/list-team";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The URL's filters, with anything malformed dropped. */
function parseFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const actor = one("actor");
  const action = one("action");
  const since = one("since");
  const until = one("until");
  return {
    actor: actor && UUID.test(actor) ? actor : null,
    action: action && (AUDIT_ACTION_GROUP_VALUES as readonly string[]).includes(action) ? (action as AuditActionGroup) : null,
    since: since && DAY.test(since) ? since : null,
    until: until && DAY.test(until) ? until : null,
  };
}

/**
 * Settings → Audit log (RP-REQ-015). Needs audit.view; the RPC checks it
 * again and only returns the session company's entries.
 */
export default async function CompanyAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "audit.view")) return <Forbidden what="the audit log" />;

    const filters = parseFilters(await searchParams);
    const [page, team] = await Promise.all([listAudit(supabase, filters), listTeam(supabase, company)]);
    if (!page) return <Forbidden what="the audit log" />;

    return (
      <div className="mb-20 flex w-full max-w-4xl flex-col gap-6">
        <SectionHeader
          title="Audit log"
          description="Changes to roles, owners, members, invites and hiring teams. Entries can't be edited or deleted."
        />
        {can(company, "agent.use") && <AskAgentAboutAudit />}
        <AuditLog
          initialEntries={page.entries}
          initialNextBefore={page.nextBefore}
          filters={filters}
          actors={team.members.map((m) => ({ userId: m.userId, name: m.name ?? m.email ?? "Unnamed member" }))}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
