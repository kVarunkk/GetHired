"use client";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function MetadataUpdateRefresh() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    (async () => {
      if (searchParams.get("metadata_updated") !== "true") return;
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();
      if (data.user && !error) {
        if (!data.user.app_metadata.type) {
          await supabase.auth.refreshSession();
          const newSearchParams = new URLSearchParams(searchParams.toString());
          newSearchParams.delete("metadata_updated");

          // Replace the URL state (cleans the URL in the browser bar)
          router.replace(
            newSearchParams.size
              ? `${pathname}?${newSearchParams.toString()}`
              : pathname,
            { scroll: false }
          );

          // 3. Force Server Component Refresh (MANDATORY)
          // This tells Next.js to fetch new Server Component data, ensuring your UI
          // (like headers, banners, etc.) instantly reflects the new 'onboarding_complete=true' state.
          router.refresh();
        }
      }
    })();
  }, [searchParams, router, pathname]);
  return <></>;
}
