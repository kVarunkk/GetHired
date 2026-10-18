import { Building2, ExternalLink, Globe, MapPin, Users } from "lucide-react";
import type { CareersPage } from "@/helpers/careers/get-careers-page";
import { LINK_KEYS, LINK_LABELS } from "@/helpers/careers/page-schema";

/** CP-REQ-003: logo, name, tag line, cover, website, social links and chips. */
export default function CareersHeader({ page }: { page: CareersPage }) {
  const chips = [
    page.headquarters && { icon: MapPin, label: page.headquarters },
    page.companySize && { icon: Users, label: `${page.companySize} people` },
    page.industry && { icon: Building2, label: page.industry },
  ].filter(Boolean) as { icon: typeof MapPin; label: string }[];
  const links = LINK_KEYS.flatMap((key) => (page.links[key] ? [{ key, href: page.links[key]! }] : []));

  return (
    <header className="flex flex-col gap-6">
      {page.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a company-uploaded image on our public bucket
        <img src={page.coverUrl} alt="" className="aspect-[4/1] w-full rounded-2xl border object-cover" />
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {page.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- company logos live on Supabase storage
          <img src={page.logoUrl} alt={`${page.name} logo`} className="h-16 w-16 rounded-xl border object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border text-2xl font-semibold" aria-hidden>
            {page.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[28px]">
            Careers at {page.name}
          </h1>
          {page.tagLine && <p className="text-[15px] leading-7 text-muted-foreground">{page.tagLine}</p>}
        </div>
      </div>
      {(chips.length > 0 || page.website || links.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-muted-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </span>
          ))}
          {page.website && (
            <a
              href={page.website}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[var(--careers-accent)] hover:underline"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden />
              Website
            </a>
          )}
          {links.map(({ key, href }) => (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[var(--careers-accent)] hover:underline"
            >
              {LINK_LABELS[key]}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </header>
  );
}
