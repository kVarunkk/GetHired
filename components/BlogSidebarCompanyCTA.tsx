import Link from "next/link";
import { ArrowRight, Bot, Tag } from "lucide-react";
import { Button } from "./ui/button";

const links = [
  {
    href: "/hire",
    label: "See how the AI recruiter works",
    icon: Bot,
  },
  {
    href: "/pricing/companies",
    label: "Compare plans and pricing",
    icon: Tag,
  },
];

// The sidebar CTA on posts written for companies.
export default function BlogSidebarCompanyCTA() {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold tracking-tight leading-snug">
        Hire tech talent faster
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Post a role, get AI-ranked candidates with reasons, and let the
        recruiter agent handle screening and outreach.
      </p>
      <Button asChild variant="brand" className="mt-4 w-full">
        <Link href="/auth/sign-up?company=true">
          Start hiring free
          <ArrowRight className="ms-2 h-4 w-4" />
        </Link>
      </Button>

      <ul className="mt-5 space-y-1 border-t pt-4">
        {links.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-sm underline underline-offset-4 transition-colors hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
