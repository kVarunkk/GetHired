import Link from "next/link";
import ImportedBadge from "@/components/candidates/ImportedBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Tables } from "@/utils/types/database.types";

export type ImportedCandidate = Pick<
  Tables<"company_candidates">,
  | "id"
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "current_title"
  | "current_company"
  | "experience_years"
  | "skills"
  | "links"
  | "resume_path"
  | "resume_content"
>;

/** The columns this summary reads, for the page's select. */
export const IMPORTED_CANDIDATE_COLUMNS =
  "id, full_name, email, phone, location, current_title, current_company, experience_years, skills, links, resume_path, resume_content";

const LINK_LABELS = [
  ["linkedin", "LinkedIn"],
  ["github", "GitHub"],
  ["portfolio", "Portfolio"],
  ["resume_url", "Resume link"],
] as const;

function linksOf(links: ImportedCandidate["links"]): { label: string; href: string }[] {
  if (!links || typeof links !== "object" || Array.isArray(links)) return [];
  return LINK_LABELS.flatMap(([key, label]) => {
    const href = links[key];
    return typeof href === "string" && /^https?:\/\//i.test(href) ? [{ label, href }] : [];
  });
}

/**
 * BI-REQ-030: the Candidate section of an imported application. A company
 * candidate has no GetHired profile, so this shows what the import holds and
 * links to the candidate page. Contact details are the company's own data
 * (BI-REQ-004).
 */
export default function ImportedCandidateSummary({ candidate }: { candidate: ImportedCandidate }) {
  const role = [candidate.current_title, candidate.current_company].filter(Boolean).join(" at ");
  const links = linksOf(candidate.links);
  const details = [
    { label: "Current role", value: role || "Not specified" },
    { label: "Location", value: candidate.location || "Not specified", className: "capitalize" },
    {
      label: "Experience",
      value:
        candidate.experience_years === null
          ? "Not specified"
          : `${candidate.experience_years} ${candidate.experience_years === 1 ? "year" : "years"}`,
    },
    { label: "Phone", value: candidate.phone || "Not specified" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {candidate.full_name}
          <ImportedBadge
            person={{ imported: true, hasResume: Boolean(candidate.resume_path || candidate.resume_content) }}
          />
        </CardTitle>
        <CardDescription>{candidate.email || "No email"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {details.map((detail) => (
          <div key={detail.label}>
            <p className="text-sm font-semibold">{detail.label}</p>
            <p className={`text-sm text-muted-foreground ${detail.className ?? ""}`}>{detail.value}</p>
          </div>
        ))}
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold">Skills</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {candidate.skills.length > 0 ? (
              candidate.skills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">Not specified</span>
            )}
          </div>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm underline underline-offset-4 hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
        <div className="sm:col-span-2">
          <Button asChild variant="outline">
            <Link href={`/company/candidates/${candidate.id}`}>Open candidate</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
