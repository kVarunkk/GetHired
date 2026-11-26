import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentToCreateRole } from "@/components/agent/recruiter/AskAgentAboutRoles";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import RoleEditor, { type RoleEditorValues } from "@/components/roles/RoleEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { can, grantList } from "@/helpers/companies/permissions";
import { grantsWithinCeiling, ROLE_COLORS, roleTemplate, type RoleColor } from "@/helpers/companies/role-templates";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Role",
};

export const dynamic = "force-dynamic";

const asColor = (c: string): RoleColor => (ROLE_COLORS as readonly string[]).includes(c) ? (c as RoleColor) : "slate";

/**
 * Settings → Roles → New (RP-REQ-014). Needs roles.manage. `?template=key`
 * prefills from a template, `?from=<role id>` duplicates a role; either is
 * narrowed to what the viewer may grant (RP-REQ-012 rule 1). `?next=invite`
 * (from the invite dialog) goes back to the invite with the new role picked.
 */
export default async function NewRolePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; from?: string; next?: string }>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "roles.manage")) return <Forbidden what="the role editor" />;

    const { template: templateKey, from, next } = await searchParams;
    let initial: RoleEditorValues = { name: "", description: "", color: "slate", grants: [], limits: {} };

    const template = templateKey ? roleTemplate(templateKey) : undefined;
    if (template) {
      initial = {
        name: template.name,
        description: template.description,
        color: template.color,
        grants: grantsWithinCeiling(company, template.grants),
        limits: {},
        templateKey: template.key,
      };
    } else if (from) {
      const source = (await listRoles(supabase, company))?.find((r) => r.id === from);
      if (source) {
        initial = {
          name: `${source.name} copy`.slice(0, 40),
          description: source.description ?? "",
          color: asColor(source.color),
          grants: grantsWithinCeiling(company, source.grants),
          limits: source.limits,
          templateKey: source.templateKey,
        };
      }
    }

    return (
      <div className="mb-20 flex w-full max-w-4xl flex-col gap-6">
        <SectionHeader
          backHref={next === "invite" ? "/company/settings/team" : "/company/settings/roles"}
          backLabel={next === "invite" ? "Back to team" : "Back to roles"}
          title="New role"
        />
        {can(company, "agent.use") && <AskAgentToCreateRole />}
        <RoleEditor
          mode="create"
          initial={initial}
          viewer={{ isOwner: company.isOwner, grants: grantList(company.grants), limits: company.limits }}
          showTemplates
          returnTo={next === "invite" ? "invite" : undefined}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
