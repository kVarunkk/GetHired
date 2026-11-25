"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import ProfileDropdown from "@/components/ProfileDropdown";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * The right side of the careers navbar: the profile menu when signed in,
 * Sign in / Sign up otherwise. The page is statically cached, so who's
 * viewing is only known in the browser; nothing shows until then, so the
 * buttons don't flash for a signed-in visitor.
 */
export default function CareersAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setResolved(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!resolved) return <div className="h-9 w-9" aria-hidden />;
  if (user) return <ProfileDropdown user={user} isMenuOpen={false} />;

  // Read from the browser (not useSearchParams) so the cached page needs no Suspense. Back to this page after signing in, so a visitor can go on to apply.
  const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/auth/login?returnTo=${returnTo}`}>Sign in</Link>
      </Button>
      <Button asChild size="sm" className="max-[400px]:hidden">
        <Link href={`/auth/sign-up?returnTo=${returnTo}`}>Sign up</Link>
      </Button>
    </div>
  );
}
