import Link from "next/link";
import type { CareersPage } from "@/helpers/careers/get-careers-page";
import { careersPath } from "@/helpers/careers/slug";
import CareersAccount from "./CareersAccount";
import { cn } from "@/utils/utils";

/** The company's own top bar on its careers pages: its logo and name, never GetHired's. */
export default function CareersNavbar({
  page,
  gutter,
  refQuery = "",
  account = true,
}: {
  page: Pick<CareersPage, "slug" | "name" | "logoUrl">;
  gutter: string;
  /** `?ref=…` kept on the home link so the referral survives a click back. */
  refQuery?: string;
  /** The profile menu or sign-in buttons; off inside the editor's preview. */
  account?: boolean;
}) {
  return (
    <nav aria-label={`${page.name} careers`} className="w-full border-b bg-background">
      <div className={cn("flex h-16 items-center justify-between gap-4", gutter)}>
        <Link href={`${careersPath(page.slug)}${refQuery}`} className="flex min-w-0 items-center gap-3">
          {page.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- company logos live on Supabase storage
            <img src={page.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg border object-contain" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base font-semibold" aria-hidden>
              {page.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-base font-semibold tracking-tight">{page.name}</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">Careers</span>
        </Link>
        {account && <CareersAccount />}
      </div>
    </nav>
  );
}
