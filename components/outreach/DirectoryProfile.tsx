import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buildSalaryRange } from "@/utils/buildSalaryRange";
import type { ResumeSectionsPublic } from "@/utils/types/outreach.types";
import { firstName } from "@/helpers/outreach/linkify";

/** What any company sees of a talent-pool candidate (OR-REQ-010). No contact fields, no resume file. */
export type DirectoryProfileData = {
  user_id: string;
  full_name: string | null;
  desired_roles: string[] | null;
  preferred_locations: string[] | null;
  job_type: string[] | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_currency: string | null;
  experience_years: number | null;
  industry_preferences: string[] | null;
  visa_sponsorship_required: boolean | null;
  top_skills: string[] | null;
  work_style_preferences: string[] | null;
  career_goals_short_term: string | null;
  career_goals_long_term: string | null;
  company_size_preference: string | null;
  accepts_outreach: boolean | null;
  resume_sections: ResumeSectionsPublic;
};

const SECTION_TITLES: Record<string, string> = {
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value || "Not specified"}</p>
    </div>
  );
}

/**
 * The directory profile (OR-TASK-012): the candidate's preferences and their
 * scrubbed resume sections. Contact details and the resume file are shared
 * when they answer an outreach Interested or apply.
 */
export default function DirectoryProfile({ profile }: { profile: DirectoryProfileData }) {
  const name = firstName(profile.full_name) ?? "This candidate";
  const salary = buildSalaryRange(profile.min_salary, profile.max_salary, profile.salary_currency ?? undefined);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* The name and desired roles are in the page's header. */}
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" />
        Contact details are shared when {name} responds or applies.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="flex flex-col gap-4 rounded-xl border p-4 md:col-span-1">
          <Field
            label="Experience"
            value={profile.experience_years != null ? `${profile.experience_years} years` : null}
          />
          <Field label="Preferred locations" value={profile.preferred_locations?.join(", ")} />
          <Field label="Job types" value={profile.job_type?.join(", ")} />
          <Field label="Work style" value={profile.work_style_preferences?.join(", ")} />
          <Field label="Salary range" value={salary} />
          <Field
            label="Visa sponsorship"
            value={profile.visa_sponsorship_required ? "Required" : "Not required"}
          />
          <Field label="Industries" value={profile.industry_preferences?.join(", ")} />
          <Field label="Company size" value={profile.company_size_preference} />
          <Field label="Short-term goals" value={profile.career_goals_short_term} />
          <Field label="Long-term goals" value={profile.career_goals_long_term} />
        </div>

        <div className="flex flex-col gap-4 md:col-span-2">
          {profile.top_skills?.length ? (
            <div className="flex flex-wrap gap-2">
              {profile.top_skills.map((skill) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))}
            </div>
          ) : null}

          {profile.resume_sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resume details yet.</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {profile.resume_sections.map((section, i) => (
                <section key={i} className="flex flex-col gap-3 px-4 py-3">
                  <h2 className="text-xs font-medium text-muted-foreground">
                    {SECTION_TITLES[section.type ?? ""] ?? section.type}
                  </h2>
                  {(section.items ?? []).map((item, j) => (
                    <div key={j} className="flex flex-col gap-1">
                      {item.heading && <p className="text-sm font-medium">{item.heading}</p>}
                      {item.subheading && <p className="text-xs text-muted-foreground">{item.subheading}</p>}
                      {item.bullets?.length ? (
                        <ul className="list-disc pl-5 text-sm leading-6">
                          {item.bullets.map((b, k) => (
                            <li key={k}>{b.text}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
